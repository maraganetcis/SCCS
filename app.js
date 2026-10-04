import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getRedirectResult,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  addDoc,
  onSnapshot,
  orderBy,
  serverTimestamp,
  startAt,
  endAt,
  limit,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported as isMessagingSupported,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyA5FX6asrpW83siWWh-j9kltfIJKsY952o",
  authDomain: "sccs-sct.firebaseapp.com",
  projectId: "sccs-sct",
  storageBucket: "sccs-sct.firebasestorage.app",
  messagingSenderId: "978910466771",
  appId: "1:978910466771:web:e80b2760511fe3107bba26",
  measurementId: "G-4EQDCFMKPP",
};



const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  profile: null,
  selectedFriend: null,
  unsubscribeChat: null,
  pendingMedia: null,
  currentUploadXhr: null,
  isUploading: false,
};

let toastTimeout = null;
function showToast(message) {
  const toast = $("toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
    return;
  }
  console.info("toast:", message);
}

function showNotice(id, message) {
  const el = $(id);
  if (el) el.textContent = message || "";
}

function friendlyErrorMessage(error) {
  const code = error?.code || "";
  if (code.includes("permission-denied")) {
    return "권한 오류: Firestore 보안 규칙에서 접근이 막혀 있습니다.";
  }
  if (code.includes("unauthenticated")) {
    return "로그인이 필요합니다. 다시 로그인 후 시도해주세요.";
  }
  if (code.includes("network-request-failed")) {
    return "네트워크 오류가 발생했습니다. 연결 상태를 확인해주세요.";
  }
  return error?.message || "알 수 없는 오류가 발생했습니다.";
}

function showGateError(message) {
  if (!message) return;
  if (!$("authGate").hidden) showNotice("authNotice", message);
  if (!$("usernameGate").hidden) showNotice("onboardNotice", message);
  showToast(message);
}

function setVisible(el, visible) {
  const node = $(el);
  node.classList.toggle("hidden", !visible);
  node.hidden = !visible;
  if (visible && el === "authGate") showNotice("authNotice", "");
  if (visible && el === "usernameGate") showNotice("onboardNotice", "");
}

function threadId(a, b) {
  return [a, b].sort().join("__");
}

function showOnboardingGate(message) {
  setVisible("authGate", false);
  setVisible("appShell", false);
  setVisible("usernameGate", true);
  if (message) showToast(message);
}

function applyTheme(color) {
  document.documentElement.style.setProperty("--accent", color || "#6e61ff");
}

async function loadProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function upsertProfile(uid, payload) {
  await setDoc(doc(db, "users", uid), payload, { merge: true });
}

async function usernameTaken(username, excludeUid) {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return true;
  const snaps = await getDocs(query(collection(db, "users"), where("username", "==", normalized)));
  if (snaps.empty) return false;
  return snaps.docs.some((d) => d.id !== excludeUid);
}

async function registerWithEmail() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!email || !password) return showToast("이메일/비밀번호를 입력하세요.");
  await createUserWithEmailAndPassword(auth, email, password);
  showToast("회원가입 완료. 아이디를 설정하세요.");
}

async function loginWithEmail() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  if (!email || !password) return showToast("이메일/비밀번호를 입력하세요.");
  await signInWithEmailAndPassword(auth, email, password);
  showToast("로그인 성공");
}

async function loginWithGoogle() {
  try {
    await signInWithPopup(auth, provider);
    showToast("Google 로그인 성공");
  } catch (error) {
    const fallbackCodes = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/operation-not-supported-in-this-environment",
    ];
    if (fallbackCodes.includes(error.code)) {
      showToast("Google 리다이렉트 로그인으로 전환합니다...");
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}

async function completeOnboarding() {
  const user = state.user || auth.currentUser;
  if (!user) return showGateError("로그인 상태가 만료됐습니다. 다시 로그인해주세요.");

  const button = $("completeOnboardingBtn");
  const username = $("onboardUsername").value.trim().toLowerCase();
  const displayName = $("onboardDisplayName").value.trim();

  if (!username) return showGateError("아이디를 입력하세요.");
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return showGateError("아이디는 3~20자 영문/숫자/_ 만 사용할 수 있습니다.");
  }

  button.disabled = true;
  button.textContent = "확인 중...";

  try {
    if (await usernameTaken(username, user.uid)) {
      throw new Error("이미 사용 중인 아이디입니다.");
    }

    await upsertProfile(user.uid, {
      username,
      displayName: displayName || username,
      displayNameLower: (displayName || username).toLowerCase(),
      bio: "안녕하세요!",
      avatar: "🙂",
      themeColor: "#6e61ff",
      createdAt: serverTimestamp(),
    });
    showNotice("onboardNotice", "");
    showToast("아이디 설정 완료");
    await bootApp();
  } catch (error) {
    console.error("complete-onboarding-failed", error);
    showGateError(friendlyErrorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = "채팅 시작하기";
  }
}

async function saveIdentity() {
  if (!state.user || !state.profile) return;
  const username = $("mpUsername").value.trim().toLowerCase();
  const displayName = $("mpDisplayName").value.trim();
  if (!username) return showToast("아이디는 비울 수 없습니다.");
  if (await usernameTaken(username, state.user.uid)) return showToast("중복 아이디입니다.");

  await upsertProfile(state.user.uid, {
    username,
    displayName: displayName || username,
    displayNameLower: (displayName || username).toLowerCase(),
  });

  state.profile.username = username;
  state.profile.displayName = displayName || username;
  bindProfile();
  showToast("이름/아이디 저장 완료");
}

async function saveProfile() {
  if (!state.user || !state.profile) return;
  const payload = {
    bio: $("mpBio").value.trim(),
    avatar: $("mpAvatar").value.trim() || "🙂",
    themeColor: $("mpTheme").value,
  };
  await upsertProfile(state.user.uid, payload);
  state.profile = { ...state.profile, ...payload };
  bindProfile();
  showToast("프로필 저장 완료");
}

function bindProfile() {
  if (!state.profile) return;
  $("myDisplayName").textContent = state.profile.displayName;
  $("myTag").textContent = `@${state.profile.username}`;
  $("myAvatar").textContent = state.profile.avatar || "🙂";

  if ($("topMyAvatar")) $("topMyAvatar").textContent = state.profile.avatar || "🙂";
  if ($("topMyName")) $("topMyName").textContent = state.profile.displayName || "마이페이지";
  if ($("composerAvatar")) $("composerAvatar").textContent = state.profile.avatar || "🙂";
  if ($("postModalAvatar")) $("postModalAvatar").textContent = state.profile.avatar || "🙂";
  if ($("postModalDisplayName")) $("postModalDisplayName").textContent = state.profile.displayName || "작성자";
  if ($("postModalTag")) $("postModalTag").textContent = `@${state.profile.username}`;

  $("mpDisplayName").value = state.profile.displayName || "";
  $("mpUsername").value = state.profile.username || "";
  $("mpBio").value = state.profile.bio || "";
  $("mpAvatar").value = state.profile.avatar || "🙂";
  $("mpTheme").value = state.profile.themeColor || "#6e61ff";
  applyTheme(state.profile.themeColor);
}

async function addFriendByUsername() {
  if (!state.user || !state.profile) return;
  const target = $("friendUsernameInput").value.trim().toLowerCase();
  if (!target) return;
  if (target === state.profile.username) return showToast("본인은 추가할 수 없습니다.");

  const users = await getDocs(query(collection(db, "users"), where("username", "==", target)));
  if (users.empty) return showToast("해당 아이디를 찾지 못했습니다.");

  const friend = users.docs[0];
  await setDoc(doc(db, "friendships", `${state.user.uid}__${friend.id}`), {
    users: [state.user.uid, friend.id],
    usernames: [state.profile.username, target],
    createdAt: serverTimestamp(),
  });
  $("friendUsernameInput").value = "";
  showToast("친구 추가 완료");
  await renderFriends();
}

async function addFriendByUid(friendUid, friendUsername) {
  if (!state.user || !state.profile) return;
  if (friendUid === state.user.uid) return showToast("본인은 추가할 수 없습니다.");
  await setDoc(doc(db, "friendships", `${state.user.uid}__${friendUid}`), {
    users: [state.user.uid, friendUid],
    usernames: [state.profile.username, friendUsername],
    createdAt: serverTimestamp(),
  });
  showToast("친구 추가 완료");
  await renderFriends();
}

async function loadPublicFriends(targetUid, targetName) {
  const list = $("publicFriendList");
  list.innerHTML = `<p class="muted">${targetName} 님 친구 목록 불러오는 중...</p>`;

  const snaps = await getDocs(query(collection(db, "friendships"), where("users", "array-contains", targetUid)));
  if (snaps.empty) {
    list.innerHTML = '<p class="muted">등록된 친구가 없습니다.</p>';
    return;
  }

  const rows = [];
  for (const item of snaps.docs) {
    const otherUid = item.data().users.find((u) => u !== targetUid);
    const profile = await loadProfile(otherUid);
    if (!profile) continue;
    rows.push(`<div class="user-result-card"><div><strong>${profile.avatar || "🙂"} ${profile.displayName}</strong><br/><span class="muted">@${profile.username}</span></div></div>`);
  }
  list.innerHTML = rows.join("");
}

async function searchUsers() {
  if (!state.user) return;
  const keywordRaw = $("searchUserInput").value.trim();
  const keyword = keywordRaw.toLowerCase();
  const result = $("userSearchResults");

  if (!keyword) {
    result.innerHTML = '<p class="muted">검색어를 입력해주세요.</p>';
    return;
  }

  const byUsername = await getDocs(query(collection(db, "users"), where("username", "==", keyword)));
  const byNameLower = await getDocs(query(collection(db, "users"), where("displayNameLower", "==", keyword)));
  const byNamePrefix = await getDocs(
    query(collection(db, "users"), orderBy("displayName"), startAt(keywordRaw), endAt(`${keywordRaw}`), limit(20))
  );

  const unique = new Map();
  [...byUsername.docs, ...byNameLower.docs, ...byNamePrefix.docs].forEach((d) => {
    if (d.id === state.user.uid) return;
    const data = d.data();
    const name = (data.displayName || "").toLowerCase();
    if (data.username === keyword || name.includes(keyword)) {
      unique.set(d.id, data);
    }
  });

  if (!unique.size) {
    result.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
    return;
  }

  result.innerHTML = "";
  unique.forEach((profile, uid) => {
    const row = document.createElement("div");
    row.className = "user-result-card";
    row.innerHTML = `<div><strong>${profile.avatar || "🙂"} ${profile.displayName}</strong><br/><span class="muted">@${profile.username}</span></div>`;

    const actions = document.createElement("div");
    actions.className = "user-result-actions";

    const addBtn = document.createElement("button");
    addBtn.textContent = "친구추가";
    addBtn.onclick = () => addFriendByUid(uid, profile.username).catch((e) => showToast(friendlyErrorMessage(e)));

    const viewBtn = document.createElement("button");
    viewBtn.textContent = "친구보기";
    viewBtn.className = "ghost";
    viewBtn.onclick = () => loadPublicFriends(uid, profile.displayName).catch((e) => showToast(friendlyErrorMessage(e)));

    actions.append(addBtn, viewBtn);
    row.append(actions);
    result.appendChild(row);
  });
}

function switchRightTab(tab) {
  const isSearch = tab === "search";
  setVisible("searchTab", isSearch);
  setVisible("quickAddTab", !isSearch);
  $("searchTabBtn").classList.toggle("active", isSearch);
  $("quickAddTabBtn").classList.toggle("active", !isSearch);
}

// Notification & Audio System
const VAPID_KEY = "BEo9-AHEqGSjdAjofAS7k2d1j86YAqPDZFETfVuCEE92C6C5vSlOEQskBtEm1cGAANCZ24bVpCHhUMU9PaLE4lA";
let audioCtx = null;
let titleInterval = null;
const originalDocTitle = document.title || "SCCS - 신촌중학교 채팅서비스";
const friendListeners = new Map();
let messagingInstance = null;
let swRegistration = null;

async function initMessaging() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const supported = await isMessagingSupported();
    if (!supported) return null;

    if (!messagingInstance) {
      messagingInstance = getMessaging(app);
      onMessage(messagingInstance, (payload) => {
        console.log("FCM 포그라운드 메시지:", payload);
        const title = payload.notification?.title || payload.data?.title || "SCCS 새 메시지 🔔";
        const body = payload.notification?.body || payload.data?.body || "새로운 메시지가 도착했습니다.";
        triggerNotification(title, body);
      });
    }

    if (!swRegistration) {
      swRegistration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
      console.log("Service Worker 등록 완료:", swRegistration.scope);
    }
    return messagingInstance;
  } catch (err) {
    console.warn("FCM init error:", err);
    return null;
  }
}

async function syncFcmToken() {
  if (!state.user) return null;
  try {
    const msg = await initMessaging();
    if (!msg || !swRegistration) return null;
    if (Notification.permission !== "granted") return null;

    const token = await getToken(msg, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swRegistration,
    });
    if (token) {
      console.log("FCM 디바이스 푸시 토큰 동기화 완료:", token);
      const userRef = doc(db, "users", state.user.uid);
      await setDoc(userRef, { fcmToken: token, lastTokenUpdate: serverTimestamp() }, { merge: true });
      return token;
    }
  } catch (err) {
    console.warn("FCM 토큰 발급/동기화 실패:", err);
  }
  return null;
}

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    // First soft chime (F#5 ~ 740Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(740, now);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);

    // Second clear resolve chime (B5 ~ 988Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(988, now + 0.09);
    gain2.gain.setValueAtTime(0.22, now + 0.09);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.09);
    osc2.stop(now + 0.42);
  } catch (e) {
    console.warn("audio-play-error", e);
  }
}

function updateNotifStatusBadge() {
  const badge = $("notifStatusBadge");
  const btn = $("enableNotifBtn");
  if (!badge) return;

  if (!("Notification" in window)) {
    badge.textContent = "미지원";
    badge.style.background = "#FEE2E2";
    badge.style.color = "#DC2626";
    if (btn) btn.disabled = true;
    return;
  }

  if (Notification.permission === "granted") {
    badge.textContent = "알림 켜짐 🔔 (백그라운드 푸시)";
    badge.style.background = "#DCFCE7";
    badge.style.color = "#16A34A";
    if (btn) btn.textContent = "알림 켜짐 ✓";
  } else if (Notification.permission === "denied") {
    badge.textContent = "차단됨 🚫";
    badge.style.background = "#FEE2E2";
    badge.style.color = "#DC2626";
    if (btn) btn.textContent = "주소창에서 허용 필요";
  } else {
    badge.textContent = "알림 꺼짐 🔕";
    badge.style.background = "var(--accent-soft)";
    badge.style.color = "var(--accent)";
    if (btn) btn.textContent = "🔔 알림 켜기";
  }
}

async function requestNotificationPermission() {
  getAudioContext();
  if (!("Notification" in window)) {
    showToast("현재 브라우저는 웹 알림을 지원하지 않습니다.");
    return false;
  }
  if (Notification.permission === "granted") {
    showToast("알림이 이미 켜져 있습니다! 🔔");
    playNotificationSound();
    updateNotifStatusBadge();
    syncFcmToken();
    return true;
  }
  try {
    const permission = await Notification.requestPermission();
    updateNotifStatusBadge();
    if (permission === "granted") {
      playNotificationSound();
      showToast("알림 및 백그라운드 푸시가 성공적으로 활성화되었습니다! 🔔");
      syncFcmToken();
      try {
        new Notification("SCCS 채팅 알림 켜짐", {
          body: "새 메시지가 도착하면 소리와 시스템 알림창으로 알려드립니다.",
          icon: "favicon.svg",
        });
      } catch (err) {}
      return true;
    } else {
      showToast("알림이 차단되었습니다. 브라우저 주소창 왼쪽 자물쇠 아이콘에서 알림을 허용해주세요.");
      return false;
    }
  } catch (err) {
    console.error("notif-req-failed", err);
    return false;
  }
}

let hasRequestedAutoNotif = false;
async function autoRequestNotification(silent = false) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    syncFcmToken();
    return;
  }
  if (Notification.permission !== "default" || hasRequestedAutoNotif) return;
  hasRequestedAutoNotif = true;

  try {
    getAudioContext();
    const permission = await Notification.requestPermission();
    updateNotifStatusBadge();
    if (permission === "granted") {
      playNotificationSound();
      syncFcmToken();
      if (!silent) {
        showToast("실시간 및 백그라운드 알림이 자동 활성화되었습니다! 🔔");
      }
    }
  } catch (err) {
    console.warn("auto-notif-failed", err);
  }
}

function setupAutoNotificationTriggers() {
  const trigger = () => {
    autoRequestNotification(true);
  };
  window.addEventListener("click", trigger, { once: true });
  window.addEventListener("touchstart", trigger, { once: true });
  window.addEventListener("keydown", trigger, { once: true });
}
setupAutoNotificationTriggers();

function testNotification() {
  getAudioContext();
  playNotificationSound();
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification("SCCS 알림 테스트 🔔", {
        body: "알림음과 알림창이 정상적으로 작동하고 있습니다!",
        icon: "favicon.svg",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (e) {
      console.warn("test-notif-failed", e);
    }
    showToast("테스트 알림과 소리를 보냈습니다!");
  } else {
    showToast("먼저 '알림 켜기'를 눌러 권한을 허용해주세요!");
    requestNotificationPermission();
  }
}

function triggerNotification(senderName, messageText, friendUid, friendData) {
  playNotificationSound();

  if ("Notification" in window && Notification.permission === "granted") {
    try {
      const notif = new Notification(`${senderName}`, {
        body: messageText,
        icon: "favicon.svg",
        tag: `sccs-chat-${friendUid}`,
        renotify: true,
      });
      notif.onclick = () => {
        window.focus();
        if (friendUid && friendData) {
          openChat(friendUid, friendData);
        }
        notif.close();
      };
    } catch (e) {
      console.warn("notification popup error", e);
    }
  }

  // Flash title in tab
  if (titleInterval) clearInterval(titleInterval);
  let step = 0;
  titleInterval = setInterval(() => {
    step++;
    document.title = step % 2 === 0 ? `💬 [새 메시지] ${senderName}` : originalDocTitle;
    if (step >= 8 || document.hasFocus()) {
      clearInterval(titleInterval);
      document.title = originalDocTitle;
    }
  }, 1000);
}

window.addEventListener("focus", () => {
  if (titleInterval) {
    clearInterval(titleInterval);
    document.title = originalDocTitle;
  }
});

// IndexedDB Local Storage System for long-term device caching
const DB_NAME = "sccs_device_cache";
const STORE_NAME = "media";

function openMediaDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "url" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function getCachedMediaBlob(url) {
  try {
    const db = await openMediaDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(url);
      req.onsuccess = () => {
        if (req.result && req.result.blob) {
          resolve(URL.createObjectURL(req.result.blob));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function cacheMediaBlob(url, blob) {
  try {
    const db = await openMediaDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ url, blob, cachedAt: Date.now() });
  } catch (e) {}
}

async function fetchAndCacheMedia(url) {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  try {
    const cached = await getCachedMediaBlob(url);
    if (cached) return cached;
    fetch(url)
      .then((r) => r.blob())
      .then((blob) => cacheMediaBlob(url, blob))
      .catch(() => {});
    return url;
  } catch (e) {
    return url;
  }
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileIcon(name = "", mime = "") {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (mime.startsWith("video/") || ["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "🎬";
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a"].includes(ext)) return "🎵";
  if (ext === "pdf") return "📕";
  if (["doc", "docx", "hwp"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📑";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["js", "ts", "html", "css", "py", "json"].includes(ext)) return "💻";
  return "📄";
}

function compressImage(file, maxWidth = 960, maxHeight = 960, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        let dataUrl = canvas.toDataURL("image/jpeg", quality);

        if (dataUrl.length > 350 * 1024) {
          const w2 = Math.min(width, 720);
          const h2 = Math.round((height * w2) / width);
          const canvas2 = document.createElement("canvas");
          canvas2.width = w2;
          canvas2.height = h2;
          const ctx2 = canvas2.getContext("2d");
          ctx2.drawImage(img, 0, 0, w2, h2);
          dataUrl = canvas2.toDataURL("image/jpeg", 0.6);
        }

        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isVideoFile(file) {
  if (!file) return false;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return (file.type && file.type.startsWith("video/")) || ["mp4", "mov", "webm", "avi", "mkv", "m4v", "3gp", "wmv", "flv"].includes(ext);
}

function isImageFile(file) {
  if (!file) return false;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return (file.type && file.type.startsWith("image/")) || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "heic", "heif"].includes(ext);
}

async function processSelectedFile(file, mode = "auto") {
  if (!file) return;
  if (!state.selectedFriend) {
    showToast("먼저 대화할 친구를 선택해주세요.");
    return;
  }

  // Cancel any existing active upload
  if (state.currentUploadXhr) {
    try {
      state.currentUploadXhr.abort();
    } catch (e) {}
    state.currentUploadXhr = null;
  }

  const maxBytes = 55 * 1024 * 1024; // 55MB maximum
  if (file.size > maxBytes) {
    showToast(`파일 용량이 너무 큽니다 (${formatSize(file.size)}). 최대 50MB 이하만 전송 가능합니다.`);
    return;
  }

  const isImg = mode === "image" || (mode === "auto" && isImageFile(file));
  const isVid = mode === "video" || (mode === "auto" && isVideoFile(file));

  // If user selected a small image via photo button, use ultra-fast adaptive client-side compression
  if (isImg && file.size < 8 * 1024 * 1024 && !file.name.toLowerCase().endsWith(".gif")) {
    showToast("사진 최적화 중... ⏳");
    try {
      const compressed = await compressImage(file);
      state.pendingMedia = {
        type: "image",
        url: compressed,
        name: file.name,
        size: Math.round(compressed.length * 0.75),
      };
      state.isUploading = false;

      $("previewThumbImg").src = compressed;
      setVisible("previewThumbImg", true);
      setVisible("previewThumbVideo", false);
      setVisible("previewFileIcon", false);
      setVisible("previewProgressBarWrap", false);
      $("previewProgressPercent").textContent = "✓ 준비됨";
      $("previewMediaText").textContent = file.name;
      $("previewMediaSub").textContent = `사진 (${formatSize(state.pendingMedia.size)}) - 전송 준비 완료`;
      setVisible("mediaPreviewBar", true);

      const sendDirectBtn = $("sendMediaDirectBtn");
      if (sendDirectBtn) {
        sendDirectBtn.disabled = false;
        sendDirectBtn.textContent = "전송";
      }
      $("sendBtn").disabled = false;
      showToast("사진 준비 완료! [전송]을 누르세요. 📷");
      return;
    } catch (err) {
      console.warn("image compression fallback to stream upload", err);
    }
  }

  // For Videos, Files, Documents & Uncompressed Images: Stream Direct Upload
  state.isUploading = true;
  state.pendingMedia = null;

  setVisible("mediaPreviewBar", true);
  setVisible("previewProgressBarWrap", true);
  $("previewProgressBar").style.width = "0%";
  $("previewProgressPercent").textContent = "0%";
  $("previewMediaText").textContent = file.name;
  $("previewMediaSub").textContent = `${isVid ? "동영상" : "파일"} 서버 전송 중... (${formatSize(file.size)})`;

  const sendDirectBtn = $("sendMediaDirectBtn");
  const mainSendBtn = $("sendBtn");
  if (sendDirectBtn) {
    sendDirectBtn.disabled = true;
    sendDirectBtn.textContent = "전송 중...";
  }
  if (mainSendBtn) {
    mainSendBtn.disabled = true;
  }

  // Immediate thumbnail preview
  if (isVid) {
    try {
      const blobUrl = URL.createObjectURL(file);
      $("previewThumbVideo").src = blobUrl;
      setVisible("previewThumbVideo", true);
      setVisible("previewThumbImg", false);
      setVisible("previewFileIcon", false);
    } catch (e) {
      $("previewFileIcon").textContent = "🎬";
      setVisible("previewFileIcon", true);
      setVisible("previewThumbVideo", false);
      setVisible("previewThumbImg", false);
    }
  } else if (isImg) {
    try {
      const blobUrl = URL.createObjectURL(file);
      $("previewThumbImg").src = blobUrl;
      setVisible("previewThumbImg", true);
      setVisible("previewThumbVideo", false);
      setVisible("previewFileIcon", false);
    } catch (e) {
      $("previewFileIcon").textContent = "🖼️";
      setVisible("previewFileIcon", true);
      setVisible("previewThumbImg", false);
      setVisible("previewThumbVideo", false);
    }
  } else {
    $("previewFileIcon").textContent = getFileIcon(file.name, file.type);
    setVisible("previewFileIcon", true);
    setVisible("previewThumbImg", false);
    setVisible("previewThumbVideo", false);
  }

  // Efficient direct streaming upload using XMLHttpRequest
  const xhr = new XMLHttpRequest();
  state.currentUploadXhr = xhr;

  const uploadEndpoint = `/api/upload-stream?filename=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(file.type || "application/octet-stream")}`;
  xhr.open("POST", uploadEndpoint, true);
  xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && e.total > 0) {
      const percent = Math.min(100, Math.round((e.loaded / e.total) * 100));
      $("previewProgressBar").style.width = `${percent}%`;
      $("previewProgressPercent").textContent = `${percent}%`;
      $("previewMediaSub").textContent = `업로드 중... ${percent}% (${formatSize(e.loaded)} / ${formatSize(e.total)})`;
    }
  };

  xhr.onload = () => {
    state.isUploading = false;
    state.currentUploadXhr = null;

    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const uploaded = JSON.parse(xhr.responseText);
        state.pendingMedia = uploaded;
        cacheMediaBlob(uploaded.url, file);

        $("previewProgressBar").style.width = "100%";
        $("previewProgressPercent").textContent = "✓ 완료";
        setVisible("previewProgressBarWrap", false);
        $("previewMediaSub").textContent = `${uploaded.type === "video" ? "동영상" : "파일"} (${formatSize(uploaded.size)}) - [전송]을 누르세요!`;

        if (sendDirectBtn) {
          sendDirectBtn.disabled = false;
          sendDirectBtn.textContent = "전송";
        }
        if (mainSendBtn) {
          mainSendBtn.disabled = false;
        }

        showToast(`${uploaded.type === "video" ? "동영상" : "파일"} 준비 완료! 전송을 누르세요. 🚀`);
      } catch (err) {
        console.error("upload-parse-failed", err);
        showToast("파일 응답을 처리하는 중 문제가 발생했습니다.");
        clearPendingMedia();
      }
    } else {
      console.error("upload-failed-status", xhr.status);
      showToast(`업로드 실패 (HTTP ${xhr.status}). 파일 형식을 확인해주세요.`);
      clearPendingMedia();
    }
  };

  xhr.onerror = () => {
    state.isUploading = false;
    state.currentUploadXhr = null;
    showToast("네트워크 오류로 파일 전송에 실패했습니다. 다시 시도해주세요.");
    clearPendingMedia();
  };

  xhr.onabort = () => {
    state.isUploading = false;
    state.currentUploadXhr = null;
  };

  xhr.send(file);
}

function clearPendingMedia() {
  if (state.currentUploadXhr) {
    try {
      state.currentUploadXhr.abort();
    } catch (e) {}
    state.currentUploadXhr = null;
  }
  state.pendingMedia = null;
  state.isUploading = false;
  setVisible("mediaPreviewBar", false);
  setVisible("previewProgressBarWrap", false);
  $("previewThumbImg").src = "";
  $("previewThumbVideo").src = "";
  $("previewProgressPercent").textContent = "";

  const sendDirectBtn = $("sendMediaDirectBtn");
  if (sendDirectBtn) {
    sendDirectBtn.disabled = false;
    sendDirectBtn.textContent = "전송";
  }
  const mainSendBtn = $("sendBtn");
  if (mainSendBtn) {
    mainSendBtn.disabled = false;
  }

  const imgInput = $("imageFileInput");
  if (imgInput) imgInput.value = "";
  const videoInput = $("videoFileInput");
  if (videoInput) videoInput.value = "";
  const fileInput = $("mediaFileInput");
  if (fileInput) fileInput.value = "";
}

function openLightbox(src) {
  $("lightboxImg").src = src;
  $("downloadImgLink").href = src;
  $("imageLightbox").showModal();
}

function closeLightbox() {
  $("imageLightbox").close();
}

function getMediaNotificationText(m) {
  if (m.media) {
    if (m.media.type === "video") return "🎬 [동영상을 보냈습니다]";
    if (m.media.type === "image") return "📷 [사진을 보냈습니다]";
    return `📎 [파일: ${m.media.name || "첨부파일"}]`;
  }
  if (m.imageUrl) return "📷 [사진을 보냈습니다]";
  return m.text || "새 메시지";
}

function syncFriendBackgroundListeners(friends) {
  if (!state.user || !friends) return;
  const currentUids = new Set(friends.map((f) => f.uid));
  for (const [uid, unsub] of friendListeners.entries()) {
    if (!currentUids.has(uid)) {
      unsub();
      friendListeners.delete(uid);
    }
  }

  friends.forEach((friend) => {
    if (friendListeners.has(friend.uid)) return;
    const tid = threadId(state.user.uid, friend.uid);
    const q = query(collection(db, "chats", tid, "messages"), orderBy("createdAt", "desc"), limit(1));
    let initial = true;
    const unsub = onSnapshot(q, (snap) => {
      if (initial) {
        initial = false;
        return;
      }
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const m = change.doc.data();
          if (m.senderUid === friend.uid) {
            const isCurrentChatVisible = state.selectedFriend?.uid === friend.uid && !document.hidden;
            if (!isCurrentChatVisible) {
              const notifMsg = getMediaNotificationText(m);
              triggerNotification(friend.displayName || "친구", notifMsg, friend.uid, friend);
              const item = document.querySelector(`.friend-item[data-uid="${friend.uid}"]`);
              if (item && !item.querySelector(".unread-dot")) {
                const dot = document.createElement("span");
                dot.className = "unread-dot";
                dot.textContent = "N";
                item.appendChild(dot);
              }
            }
          }
        }
      });
    });
    friendListeners.set(friend.uid, unsub);
  });
}

async function renderFriends() {
  if (!state.user) return;
  const list = $("friendList");
  list.innerHTML = "";
  const snaps = await getDocs(query(collection(db, "friendships"), where("users", "array-contains", state.user.uid)));
  if (snaps.empty) {
    list.innerHTML = '<p class="muted">아직 친구가 없습니다.</p>';
    syncFriendBackgroundListeners([]);
    return;
  }

  const loadedFriends = [];
  for (const item of snaps.docs) {
    const friendUid = item.data().users.find((u) => u !== state.user.uid);
    const friend = await loadProfile(friendUid);
    if (!friend) continue;
    loadedFriends.push({ uid: friendUid, ...friend });
    const btn = document.createElement("button");
    btn.className = "friend-item";
    btn.dataset.uid = friendUid;
    btn.innerHTML = `<strong>${friend.avatar || "🙂"} ${friend.displayName}</strong><br/><span class="muted">@${friend.username}</span>`;
    btn.onclick = () => openChat(friendUid, friend);
    list.appendChild(btn);
  }
  syncFriendBackgroundListeners(loadedFriends);
}

function appendMediaToBubble(m, bubble) {
  const media = m.media || (m.imageUrl ? { type: "image", url: m.imageUrl, name: "사진" } : null);
  if (!media) return;

  if (media.type === "image") {
    const img = document.createElement("img");
    img.className = "chat-img";
    img.alt = media.name || "사진";
    img.loading = "lazy";
    img.src = media.url;
    fetchAndCacheMedia(media.url).then((resolvedUrl) => {
      img.src = resolvedUrl;
    });
    img.onclick = () => openLightbox(img.src);
    bubble.appendChild(img);
  } else if (media.type === "video") {
    const videoWrap = document.createElement("div");
    videoWrap.className = "chat-video-wrap";

    const video = document.createElement("video");
    video.className = "chat-video";
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = media.url;
    getCachedMediaBlob(media.url).then((cached) => {
      if (cached) video.src = cached;
    });

    const metaRow = document.createElement("div");
    metaRow.className = "video-meta-row";
    metaRow.innerHTML = `
      <span class="video-meta-name">🎬 ${media.name || "동영상"} (${formatSize(media.size)})</span>
      <a href="${media.url}" download="${media.name || 'video.mp4'}" class="video-dl-link" title="동영상 다운로드">💾 저장</a>
    `;

    videoWrap.append(video, metaRow);
    bubble.appendChild(videoWrap);
  } else {
    const card = document.createElement("a");
    card.className = "chat-file-card";
    card.href = media.url;
    card.download = media.name || "download";
    card.target = "_blank";

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = getFileIcon(media.name || "", media.mime || "");

    const info = document.createElement("div");
    info.className = "file-info";
    info.innerHTML = `
      <span class="file-name">${media.name || "첨부 파일"}</span>
      <span class="file-meta">${formatSize(media.size)} • 💾 기기 보관 지원</span>
    `;

    const dl = document.createElement("span");
    dl.className = "file-download-badge";
    dl.textContent = "다운로드";

    card.append(icon, info, dl);
    bubble.appendChild(card);
  }
}

function openChat(friendUid, friend) {
  autoRequestNotification();
  state.selectedFriend = { uid: friendUid, ...friend };
  $("chatTitle").textContent = `${friend.avatar || "🙂"} ${friend.displayName}`;
  $("chatSubtitle").textContent = friend.bio || "";
  clearPendingMedia();

  document.querySelectorAll(".friend-item").forEach((el) => {
    const isTarget = el.dataset.uid === friendUid;
    el.classList.toggle("active", isTarget);
    if (isTarget) {
      const badge = el.querySelector(".unread-dot");
      if (badge) badge.remove();
    }
  });

  if (state.unsubscribeChat) state.unsubscribeChat();
  const id = threadId(state.user.uid, friendUid);
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt", "asc"));
  let initial = true;
  state.unsubscribeChat = onSnapshot(q, (snap) => {
    const area = $("messageArea");
    area.innerHTML = "";
    snap.docs.forEach((d) => {
      const m = d.data();
      const bubble = document.createElement("div");
      bubble.className = `message ${m.senderUid === state.user.uid ? "me" : "them"}`;
      
      appendMediaToBubble(m, bubble);

      if (m.text) {
        const textSpan = document.createElement("div");
        textSpan.textContent = m.text;
        if (m.media || m.imageUrl) textSpan.style.marginTop = "6px";
        bubble.appendChild(textSpan);
      }
      area.appendChild(bubble);
    });
    area.scrollTop = area.scrollHeight;

    if (!initial) {
      snap.docChanges().forEach((change) => {
        if (change.type === "added") {
          const m = change.doc.data();
          if (m.senderUid !== state.user.uid) {
            const notifMsg = getMediaNotificationText(m);
            triggerNotification(friend.displayName || "친구", notifMsg, friendUid, friend);
          }
        }
      });
    }
    initial = false;
  });
}

async function sendMessage() {
  if (!state.user || !state.selectedFriend) return showToast("친구를 먼저 선택하세요.");
  if (state.isUploading) return showToast("파일 업로드가 진행 중입니다. 잠시만 기다려주세요... ⏳");
  const text = $("messageInput").value.trim();
  const media = state.pendingMedia;
  if (!text && !media) return;

  const id = threadId(state.user.uid, state.selectedFriend.uid);
  clearPendingMedia();
  $("messageInput").value = "";

  const payload = {
    senderUid: state.user.uid,
    createdAt: serverTimestamp(),
  };
  if (text) payload.text = text;
  if (media) {
    payload.media = media;
    if (media.type === "image") payload.imageUrl = media.url;
  }

  await addDoc(collection(db, "chats", id, "messages"), payload);
}

async function bootApp() {
  try {
    state.profile = await loadProfile(state.user.uid);
  } catch (error) {
    console.error("profile-load-failed", error);
    state.profile = null;
    showOnboardingGate("프로필 확인 중 문제가 있어 아이디 설정 화면으로 이동했습니다.");
    return;
  }

  if (!state.profile?.username) {
    showOnboardingGate();
    return;
  }
  bindProfile();
  await renderFriends();
  updateNotifStatusBadge();
  syncFcmToken();
  setVisible("authGate", false);
  setVisible("usernameGate", false);
  setVisible("appShell", true);
  handleRoute(getCurrentRoute());
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user) {
    state.profile = null;
    setVisible("authGate", true);
    setVisible("usernameGate", false);
    setVisible("appShell", false);
    return;
  }

  try {
    await bootApp();
  } catch (error) {
    console.error("auth-state-boot-failed", error);
    showOnboardingGate("로그인은 완료됐지만 화면 전환에 실패해 아이디 설정으로 이동했습니다.");
  }
});

getRedirectResult(auth).catch((error) => {
  console.error("google-redirect-failed", error);
  showToast(friendlyErrorMessage(error));
});

$("googleBtn").onclick = () => {
  autoRequestNotification();
  loginWithGoogle().catch((e) => showGateError(friendlyErrorMessage(e)));
};
$("completeOnboardingBtn").onclick = () => {
  autoRequestNotification();
  completeOnboarding().catch((e) => showGateError(friendlyErrorMessage(e)));
};
$("addFriendBtn").onclick = () => addFriendByUsername().catch((e) => showToast(friendlyErrorMessage(e)));
$("sendBtn").onclick = () => sendMessage().catch((e) => showToast(friendlyErrorMessage(e)));
$("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage().catch((err) => showToast(friendlyErrorMessage(err)));
});
$("searchUserBtn").onclick = () => searchUsers().catch((e) => showToast(friendlyErrorMessage(e)));
$("searchUserInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") searchUsers().catch((err) => showToast(friendlyErrorMessage(err)));
});
$("searchTabBtn").onclick = () => switchRightTab("search");
$("quickAddTabBtn").onclick = () => switchRightTab("quick");
$("openMyPage").onclick = () => $("myPageDialog").showModal();
$("saveIdentityBtn").onclick = (e) => {
  e.preventDefault();
  saveIdentity().catch((err) => showToast(friendlyErrorMessage(err)));
};
$("saveProfileBtn").onclick = (e) => {
  e.preventDefault();
  saveProfile().catch((err) => showToast(friendlyErrorMessage(err)));
};
$("logoutBtn").onclick = async (e) => {
  e.preventDefault();
  await signOut(auth);
  $("myPageDialog").close();
};

const enableBtn = $("enableNotifBtn");
if (enableBtn) enableBtn.onclick = () => requestNotificationPermission();

const testBtn = $("testNotifBtn");
if (testBtn) testBtn.onclick = () => testNotification();

updateNotifStatusBadge();

// Media Attachment, Cancel, Drag & Drop, and Paste Listeners
const attachImgBtn = $("attachImgBtn");
const imgInput = $("imageFileInput");
const attachVideoBtn = $("attachVideoBtn");
const videoInput = $("videoFileInput");
const attachFileBtn = $("attachFileBtn");
const mediaFileInput = $("mediaFileInput");
const cancelMediaBtn = $("cancelMediaBtn");
const sendMediaDirectBtn = $("sendMediaDirectBtn");
const closeLightBtn = $("closeLightboxBtn");
const lightboxDialog = $("imageLightbox");

if (attachImgBtn && imgInput) {
  attachImgBtn.onclick = () => {
    if (!state.selectedFriend) {
      showToast("먼저 대화할 친구를 선택해주세요.");
      return;
    }
    imgInput.value = "";
    imgInput.click();
  };
  imgInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0], "image");
    }
  };
}

if (attachVideoBtn && videoInput) {
  attachVideoBtn.onclick = () => {
    if (!state.selectedFriend) {
      showToast("먼저 대화할 친구를 선택해주세요.");
      return;
    }
    videoInput.value = "";
    videoInput.click();
  };
  videoInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0], "video");
    }
  };
}

if (attachFileBtn && mediaFileInput) {
  attachFileBtn.onclick = () => {
    if (!state.selectedFriend) {
      showToast("먼저 대화할 친구를 선택해주세요.");
      return;
    }
    mediaFileInput.value = "";
    mediaFileInput.click();
  };
  mediaFileInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0], "auto");
    }
  };
}

if (sendMediaDirectBtn) {
  sendMediaDirectBtn.onclick = () => {
    sendMessage().catch((err) => showToast(friendlyErrorMessage(err)));
  };
}

if (cancelMediaBtn) {
  cancelMediaBtn.onclick = () => clearPendingMedia();
}

if (closeLightBtn) {
  closeLightBtn.onclick = () => closeLightbox();
}

if (lightboxDialog) {
  lightboxDialog.onclick = (e) => {
    if (e.target === lightboxDialog) closeLightbox();
  };
}

// Clipboard Paste (Ctrl+V / Cmd+V for images and files)
window.addEventListener("paste", (e) => {
  if (!state.selectedFriend) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === "file") {
      e.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      processSelectedFile(file, "auto");
      break;
    }
  }
});

// Drag & Drop Files/Videos/Images into Chat
const chatPanelEl = document.querySelector(".chat-panel");
if (chatPanelEl) {
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      chatPanelEl.classList.add("dragover");
    }
  });
  window.addEventListener("dragleave", (e) => {
    if (e.clientY <= 0 || e.clientX <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      chatPanelEl.classList.remove("dragover");
    }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    chatPanelEl.classList.remove("dragover");
    if (!state.selectedFriend) {
      showToast("먼저 대화할 친구를 선택해주세요.");
      return;
    }
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processSelectedFile(files[0], "auto");
    }
  });
}

// ==========================================================================
// SPA URL Routing & Modern SVG Icons System
// ==========================================================================
const SVG = {
  heart: (filled = false) => filled
    ? `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="#EF4444" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
    : `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
  comment: `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`,
  share: `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
  trash: `<svg class="ui-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  videoBadge: `<svg class="ui-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  chat: `<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  userPlus: `<svg class="ui-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  userCheck: `<svg class="ui-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  edit: `<svg class="ui-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  link: `<svg class="ui-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
};

function formatTimeAgo(date) {
  if (!date) return "";
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return "방금 전";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function getCurrentRoute() {
  if (window.location.hash && window.location.hash.length > 1) {
    const rawHash = window.location.hash.substring(1);
    return rawHash.startsWith("/") ? rawHash : "/" + rawHash;
  }
  return window.location.pathname || "/";
}

function navigateTo(path, push = true) {
  const normPath = path.startsWith("/") ? path : "/" + path;
  if (push) {
    try {
      window.history.pushState(null, "", normPath);
    } catch (e) {}
    try {
      window.location.hash = normPath;
    } catch (e) {}
  }
  handleRoute(normPath);
}

function handleRoute(path = getCurrentRoute()) {
  let clean = (path || "/").trim().replace(/^#\/?/, "/").replace(/\/+$/, "") || "/";
  if (clean.startsWith("/profile/")) {
    clean = "/@" + clean.substring(9);
  }

  // Update navbar items
  $("navChatBtn")?.classList.remove("active");
  $("navFeedBtn")?.classList.remove("active");
  $("navProfileBtn")?.classList.remove("active");

  // Hide all panels
  setVisible("viewChat", false);
  setVisible("viewFeed", false);
  setVisible("viewProfile", false);

  if (clean === "/" || clean === "/chat") {
    state.currentRoute = "/chat";
    $("navChatBtn")?.classList.add("active");
    setVisible("viewChat", true);
    document.title = "SCCS - 신촌중학교 채팅서비스";
  } else if (clean === "/feed" || clean === "/lounge") {
    state.currentRoute = clean;
    $("navFeedBtn")?.classList.add("active");
    setVisible("viewFeed", true);
    document.title = "SCCS - 라운지";
    startFeedListener();
  } else if (clean === "/me") {
    if (state.profile?.username) {
      navigateTo(`/@${state.profile.username}`, false);
    } else {
      navigateTo("/chat", false);
    }
  } else if (clean.startsWith("/@") || clean.startsWith("/u/")) {
    state.currentRoute = clean;
    const username = clean.startsWith("/@") ? clean.substring(2) : clean.substring(3);
    if (state.profile?.username && username.toLowerCase() === state.profile.username.toLowerCase()) {
      $("navProfileBtn")?.classList.add("active");
    }
    setVisible("viewProfile", true);
    loadUserProfilePage(username);
  } else {
    state.currentRoute = "/chat";
    $("navChatBtn")?.classList.add("active");
    setVisible("viewChat", true);
  }
}

window.addEventListener("popstate", () => {
  handleRoute(getCurrentRoute());
});
window.addEventListener("hashchange", () => {
  handleRoute(getCurrentRoute());
});

// Top Nav Listeners
$("navChatBtn").onclick = () => navigateTo("/chat");
$("navFeedBtn").onclick = () => navigateTo("/feed");
$("navProfileBtn").onclick = () => {
  if (state.profile?.username) navigateTo(`/@${state.profile.username}`);
  else showToast("먼저 프로필을 설정해주세요.");
};
$("navBrandLogo").onclick = () => navigateTo("/feed");
$("topMyPageBtn").onclick = () => $("myPageDialog").showModal();
const leftUserCard = $("leftUserCard");
if (leftUserCard) {
  leftUserCard.onclick = () => {
    if (state.profile?.username) navigateTo(`/@${state.profile.username}`);
  };
}

// ==========================================================================
// New Post Creation & Robust Storage System
// ==========================================================================
function openNewPostModal() {
  if (!state.user || !state.profile) return showToast("로그인이 필요합니다.");
  bindProfile();
  clearPostMedia();
  $("postContentInput").value = "";
  $("newPostDialog").showModal();
}

$("openNewPostBtn").onclick = () => openNewPostModal();
$("composerTriggerBtn").onclick = () => openNewPostModal();
$("composerOpenBtn").onclick = () => openNewPostModal();
$("closePostModalBtn").onclick = () => $("newPostDialog").close();
$("cancelPostBtn").onclick = () => $("newPostDialog").close();

const postImgInput = $("postImgInput");
const postVideoInput = $("postVideoInput");
const postAddImgBtn = $("postAddImgBtn");
const postAddVideoBtn = $("postAddVideoBtn");
const removePostMediaBtn = $("removePostMediaBtn");
const submitPostBtn = $("submitPostBtn");

if (postAddImgBtn && postImgInput) {
  postAddImgBtn.onclick = () => postImgInput.click();
  postImgInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handlePostMediaUpload(e.target.files[0]);
    }
  };
}

if (postAddVideoBtn && postVideoInput) {
  postAddVideoBtn.onclick = () => postVideoInput.click();
  postVideoInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handlePostMediaUpload(e.target.files[0]);
    }
  };
}

if (removePostMediaBtn) {
  removePostMediaBtn.onclick = () => clearPostMedia();
}

function handlePostMediaUpload(file) {
  if (!file) return;
  state.isPostUploading = true;
  setVisible("postMediaPreviewWrap", true);
  setVisible("postUploadProgressBarWrap", true);
  $("postUploadProgressBar").style.width = "0%";
  $("postUploadStatusText").textContent = "미디어 파일 준비 중...";

  const isImg = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (isImg) {
    $("postPreviewImg").src = URL.createObjectURL(file);
    setVisible("postPreviewImg", true);
    setVisible("postPreviewVideo", false);
  } else if (isVideo) {
    $("postPreviewVideo").src = URL.createObjectURL(file);
    setVisible("postPreviewVideo", true);
    setVisible("postPreviewImg", false);
  }

  const xhr = new XMLHttpRequest();
  state.currentPostUploadXhr = xhr;
  const endpoint = `/api/upload-stream?filename=${encodeURIComponent(file.name)}&mimeType=${encodeURIComponent(file.type || "application/octet-stream")}`;
  xhr.open("POST", endpoint, true);
  xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable && e.total > 0) {
      const pct = Math.min(100, Math.round((e.loaded / e.total) * 100));
      $("postUploadProgressBar").style.width = `${pct}%`;
      $("postUploadStatusText").textContent = `업로드 중... ${pct}% (${formatSize(e.loaded)} / ${formatSize(e.total)})`;
    }
  };

  xhr.onload = () => {
    state.isPostUploading = false;
    state.currentPostUploadXhr = null;
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const uploaded = JSON.parse(xhr.responseText);
        state.pendingPostMedia = {
          url: String(uploaded.url),
          name: String(uploaded.name || file.name),
          type: String(uploaded.type || (isVideo ? "video" : "image")),
          mime: String(uploaded.mime || file.type || ""),
          size: Number(uploaded.size || file.size || 0),
        };
        setVisible("postUploadProgressBarWrap", false);
        $("postUploadStatusText").textContent = `✓ ${uploaded.type === "video" ? "동영상" : "사진"} 첨부 완료 (${formatSize(uploaded.size)})`;
        showToast("미디어 첨부 완료! 이제 게시하기를 누르세요.");
      } catch (err) {
        showToast("파일 응답 처리 오류");
        clearPostMedia();
      }
    } else {
      showToast("업로드 실패 (HTTP " + xhr.status + ")");
      clearPostMedia();
    }
  };

  xhr.onerror = () => {
    state.isPostUploading = false;
    state.currentPostUploadXhr = null;
    showToast("네트워크 오류로 업로드에 실패했습니다.");
    clearPostMedia();
  };

  xhr.send(file);
}

function clearPostMedia() {
  if (state.currentPostUploadXhr) {
    try { state.currentPostUploadXhr.abort(); } catch (e) {}
    state.currentPostUploadXhr = null;
  }
  state.pendingPostMedia = null;
  state.isPostUploading = false;
  setVisible("postMediaPreviewWrap", false);
  setVisible("postUploadProgressBarWrap", false);
  $("postPreviewImg").src = "";
  $("postPreviewVideo").src = "";
  $("postUploadStatusText").textContent = "";
  if (postImgInput) postImgInput.value = "";
  if (postVideoInput) postVideoInput.value = "";
}

async function submitPost() {
  if (!state.user || !state.profile) return showToast("로그인이 필요합니다.");
  if (state.isPostUploading) return showToast("미디어 파일 업로드가 진행 중입니다. 잠시만 기다려주세요...");

  const content = $("postContentInput").value.trim();
  const media = state.pendingPostMedia;

  if (!content && !media) {
    return showToast("내용이나 사진, 동영상을 입력해주세요.");
  }

  const payload = {
    authorUid: String(state.user.uid),
    authorName: String(state.profile.displayName || "익명"),
    authorUsername: String(state.profile.username || "user"),
    authorAvatar: String(state.profile.avatar || "👤"),
    content: String(content || ""),
    likes: [],
    likeCount: 0,
    commentCount: 0,
    createdAt: serverTimestamp(),
  };

  if (media && media.url) {
    payload.media = {
      url: String(media.url),
      name: String(media.name || "file"),
      type: String(media.type || "file"),
      size: Number(media.size || 0),
    };
  }

  try {
    submitPostBtn.disabled = true;
    submitPostBtn.textContent = "게시 중...";

    let saved = false;

    // 1. Save to server API first (instant, 100% reliable)
    try {
      const resp = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorUid: state.user.uid,
          authorName: state.profile?.displayName || "익명",
          authorUsername: state.profile?.username || "user",
          authorAvatar: state.profile?.avatar || "👤",
          content,
          media: payload.media || null,
        }),
      });
      if (resp.ok) {
        saved = true;
      }
    } catch (srvErr) {
      console.warn("Server post save error:", srvErr);
    }

    // 2. Also try Firebase Firestore with a short timeout so it never hangs
    try {
      const fsWrite = addDoc(collection(db, "posts"), payload);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500));
      await Promise.race([fsWrite, timeout]);
      saved = true;
    } catch (fsErr) {
      console.warn("Firestore post save ignored or timed out:", fsErr);
    }

    if (!saved) {
      throw new Error("서버 및 데이터베이스 저장에 실패했습니다.");
    }

    $("postContentInput").value = "";
    clearPostMedia();
    $("newPostDialog").close();
    showToast("라운지에 게시물이 등록되었습니다!");
    navigateTo("/feed");
    await loadFeedFromServer();
  } catch (err) {
    console.error("submit-post-error", err);
    showToast("게시물 등록 실패: " + (err.message || err.code || "알 수 없는 오류"));
  } finally {
    submitPostBtn.disabled = false;
    submitPostBtn.innerHTML = `<svg class="ui-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> <span>게시하기</span>`;
  }
}

if (submitPostBtn) {
  submitPostBtn.onclick = () => submitPost();
}

// ==========================================================================
// Lounge Real-time Stream & Interaction
// ==========================================================================
async function loadFeedFromServer() {
  try {
    const resp = await fetch("/api/posts");
    if (!resp.ok) return;
    const posts = await resp.json();
    const feedList = $("feedPostsList");
    if (!feedList) return;

    if (!posts || posts.length === 0) {
      feedList.innerHTML = `
        <div class="feed-composer-card glass" style="text-align:center; display:block; padding:40px 20px;">
          <div style="font-size:32px; margin-bottom:12px; color:var(--accent);">
            <svg class="ui-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>
          </div>
          <h3 style="font-size:16px; font-weight:700; margin-bottom:6px;">아직 라운지 글이 없습니다</h3>
          <p class="muted" style="font-size:13px; margin-bottom:16px;">첫 번째 일상이나 멋진 사진, 영상을 공유해보세요!</p>
          <button class="primary composer-btn" id="emptyPostBtn">새 글 작성</button>
        </div>
      `;
      const btn = $("emptyPostBtn");
      if (btn) btn.onclick = () => openNewPostModal();
      return;
    }

    feedList.innerHTML = "";
    posts.forEach((post) => {
      const card = createFeedPostCard(post);
      feedList.appendChild(card);
    });
  } catch (err) {
    console.warn("loadFeedFromServer error", err);
  }
}

function startFeedListener() {
  loadFeedFromServer();
  if (state.unsubscribeFeed) return;
  const feedList = $("feedPostsList");
  if (!feedList) return;

  try {
    const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
    state.unsubscribeFeed = onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          feedList.innerHTML = "";
          snapshot.forEach((docSnap) => {
            const post = { id: docSnap.id, ...docSnap.data() };
            const card = createFeedPostCard(post);
            feedList.appendChild(card);
          });
        } else {
          loadFeedFromServer();
        }
      },
      (err) => {
        console.warn("Firestore listener not permitted, using server posts store:", err);
        loadFeedFromServer();
      }
    );
  } catch (e) {
    loadFeedFromServer();
  }
}

function createFeedPostCard(post) {
  const card = document.createElement("article");
  card.className = "feed-post-card";
  card.id = `post-${post.id}`;

  let date = new Date();
  if (post.createdAt?.toDate) {
    date = post.createdAt.toDate();
  } else if (typeof post.createdAt === "string") {
    date = new Date(post.createdAt);
  }
  const timeStr = formatTimeAgo(date);
  const likes = post.likes || [];
  const isLiked = state.user && likes.includes(state.user.uid);
  const isOwnPost = state.user && post.authorUid === state.user.uid;

  let mediaHtml = "";
  if (post.media) {
    if (post.media.type === "video") {
      mediaHtml = `
        <div class="feed-post-media-wrap">
          <video src="${post.media.url}" class="feed-post-video" controls playsinline preload="metadata"></video>
        </div>
      `;
    } else {
      mediaHtml = `
        <div class="feed-post-media-wrap">
          <img src="${post.media.url}" alt="게시물 사진" class="feed-post-img" loading="lazy" />
        </div>
      `;
    }
  }

  card.innerHTML = `
    <header class="feed-post-header">
      <div class="feed-post-author" role="button" tabindex="0">
        <div class="post-author-avatar">${post.authorAvatar || "👤"}</div>
        <div>
          <div class="post-author-name">${post.authorName}</div>
          <div class="post-author-username">@${post.authorUsername} · <span class="post-time-ago">${timeStr}</span></div>
        </div>
      </div>
      ${isOwnPost ? `<button class="post-delete-btn" title="삭제">${SVG.trash}</button>` : ""}
    </header>

    ${post.content ? `<div class="feed-post-body">${post.content}</div>` : ""}
    ${mediaHtml}

    <div class="feed-post-actions-bar">
      <button type="button" class="action-icon-btn like-btn ${isLiked ? "liked" : ""}">
        <span class="action-icon">${SVG.heart(isLiked)}</span>
        <span>좋아요 <strong class="like-count">${likes.length}</strong></span>
      </button>
      <button type="button" class="action-icon-btn comment-btn">
        <span class="action-icon">${SVG.comment}</span>
        <span>댓글 <strong>${post.commentCount || (post.comments || []).length || 0}</strong></span>
      </button>
      <button type="button" class="action-icon-btn share-btn">
        <span class="action-icon">${SVG.share}</span>
        <span>공유</span>
      </button>
    </div>

    <div class="feed-post-comments-wrap hidden" hidden>
      <div class="comments-list"></div>
      <form class="comment-input-bar">
        <input type="text" placeholder="댓글을 입력하세요..." required />
        <button type="submit" class="primary">등록</button>
      </form>
    </div>
  `;

  // Author click
  card.querySelector(".feed-post-author").onclick = () => {
    navigateTo(`/@${post.authorUsername}`);
  };

  // Image click lightbox
  const imgEl = card.querySelector(".feed-post-img");
  if (imgEl && post.media?.url) {
    imgEl.onclick = () => openLightbox(post.media.url);
  }

  // Delete button
  if (isOwnPost) {
    const delBtn = card.querySelector(".post-delete-btn");
    if (delBtn) delBtn.onclick = () => deletePost(post.id);
  }

  // Like button
  const likeBtn = card.querySelector(".like-btn");
  likeBtn.onclick = async () => {
    await togglePostLike(post.id, likes);
  };

  // Share button
  const shareBtn = card.querySelector(".share-btn");
  shareBtn.onclick = () => {
    const url = `${window.location.origin}/@${post.authorUsername}`;
    navigator.clipboard.writeText(url);
    showToast("프로필 및 게시물 링크가 복사되었습니다! 🔗");
  };

  // Comments toggle & submission
  const commentBtn = card.querySelector(".comment-btn");
  const commentsWrap = card.querySelector(".feed-post-comments-wrap");
  let unsubCardComments = null;

  commentBtn.onclick = () => {
    const isHidden = commentsWrap.hasAttribute("hidden");
    setVisible(commentsWrap, isHidden);
    if (isHidden) {
      const renderCommentsArray = (arr) => {
        const list = commentsWrap.querySelector(".comments-list");
        if (!arr || arr.length === 0) {
          list.innerHTML = `<div class="muted" style="font-size:12px; padding:6px 0;">첫 댓글을 남겨보세요.</div>`;
          return;
        }
        list.innerHTML = "";
        arr.forEach((c) => {
          let cDate = new Date();
          if (c.createdAt?.toDate) cDate = c.createdAt.toDate();
          else if (typeof c.createdAt === "string") cDate = new Date(c.createdAt);
          const row = document.createElement("div");
          row.className = "comment-row";
          row.innerHTML = `
            <div class="comment-avatar">${c.authorAvatar || "👤"}</div>
            <div class="comment-content">
              <div><strong class="comment-author-name">${c.authorName}</strong> <span class="comment-text">${c.text}</span></div>
              <span class="comment-time">${formatTimeAgo(cDate)}</span>
            </div>
          `;
          list.appendChild(row);
        });
      };

      if (Array.isArray(post.comments) && post.comments.length > 0) {
        renderCommentsArray(post.comments);
      }

      if (!unsubCardComments) {
        try {
          const qComments = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "asc"));
          unsubCardComments = onSnapshot(
            qComments,
            (snap) => {
              if (!snap.empty) {
                const list = commentsWrap.querySelector(".comments-list");
                list.innerHTML = "";
                snap.forEach((doc) => {
                  const c = doc.data();
                  const row = document.createElement("div");
                  row.className = "comment-row";
                  row.innerHTML = `
                    <div class="comment-avatar">${c.authorAvatar || "👤"}</div>
                    <div class="comment-content">
                      <div><strong class="comment-author-name">${c.authorName}</strong> <span class="comment-text">${c.text}</span></div>
                      <span class="comment-time">${formatTimeAgo(c.createdAt?.toDate ? c.createdAt.toDate() : new Date())}</span>
                    </div>
                  `;
                  list.appendChild(row);
                });
              }
            },
            (err) => {
              console.warn("comment firestore listen error", err);
            }
          );
        } catch (e) {}
      }
    }
  };

  const commentForm = card.querySelector(".comment-input-bar");
  commentForm.onsubmit = async (e) => {
    e.preventDefault();
    const input = commentForm.querySelector("input");
    await submitComment(post.id, input);
  };

  return card;
}

async function togglePostLike(postId, currentLikes = []) {
  if (!state.user) return showToast("로그인이 필요합니다.");
  const uid = state.user.uid;
  const isLiked = currentLikes.includes(uid);

  // Optimistic UI update
  const card = $(`post-${postId}`);
  if (card) {
    const likeBtn = card.querySelector(".like-btn");
    const countEl = card.querySelector(".like-count");
    const nextLiked = !isLiked;
    likeBtn.classList.toggle("liked", nextLiked);
    likeBtn.querySelector(".action-icon").innerHTML = SVG.heart(nextLiked);
    const newCount = nextLiked ? currentLikes.length + 1 : Math.max(0, currentLikes.length - 1);
    countEl.textContent = newCount;
    if (nextLiked) currentLikes.push(uid);
    else {
      const idx = currentLikes.indexOf(uid);
      if (idx > -1) currentLikes.splice(idx, 1);
    }
  }

  // 1. Server API
  try {
    await fetch(`/api/posts/${postId}/like`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
    });
  } catch (e) {}

  // 2. Firestore
  try {
    const postRef = doc(db, "posts", postId);
    if (isLiked) {
      await updateDoc(postRef, {
        likes: arrayRemove(uid),
        likeCount: Math.max(0, currentLikes.length - 1),
      });
    } else {
      await updateDoc(postRef, {
        likes: arrayUnion(uid),
        likeCount: currentLikes.length + 1,
      });
    }
  } catch (err) {}
}

async function submitComment(postId, inputEl) {
  if (!state.user || !state.profile) return showToast("로그인이 필요합니다.");
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.value = "";

  const payload = {
    authorUid: state.user.uid,
    authorName: state.profile.displayName || "익명",
    authorUsername: state.profile.username || "user",
    authorAvatar: state.profile.avatar || "👤",
    text,
  };

  // 1. Server API
  try {
    await fetch(`/api/posts/${postId}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {}

  // 2. Firestore
  try {
    await addDoc(collection(db, "posts", postId, "comments"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (postSnap.exists()) {
      const cur = postSnap.data().commentCount || 0;
      await updateDoc(postRef, { commentCount: cur + 1 });
    }
  } catch (err) {}

  showToast("댓글이 등록되었습니다!");
  loadFeedFromServer();
}

async function deletePost(postId) {
  if (!confirm("게시물을 정말 삭제하시겠습니까?")) return;

  try {
    await fetch(`/api/posts/${postId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: state.user.uid }),
    });
  } catch (e) {}

  try {
    await deleteDoc(doc(db, "posts", postId));
  } catch (err) {}

  showToast("게시물이 삭제되었습니다.");
  const card = $(`post-${postId}`);
  if (card) card.remove();
  loadFeedFromServer();

  if (state.currentRoute.startsWith("/@") || state.currentRoute.startsWith("/u/")) {
    const username = state.currentRoute.startsWith("/@") ? state.currentRoute.substring(2) : state.currentRoute.substring(3);
    loadUserProfilePage(username);
  }
}

// ==========================================================================
// Profile View & 3-Column Modern Gallery
// ==========================================================================
async function loadUserProfilePage(username) {
  if (!username) return;
  state.viewingProfileUsername = username;
  document.title = `SCCS - @${username}님의 프로필`;

  const heroName = $("profileViewDisplayName");
  const heroTag = $("profileViewTag");
  const heroBio = $("profileViewBio");
  const heroAvatar = $("profileViewAvatar");
  const heroIdentity = $("profileViewIdentity");
  const postCountEl = $("profilePostCount");
  const friendCountEl = $("profileFriendCount");
  const actionsBar = $("profileActionBtns");
  const gridEl = $("profilePostGrid");

  gridEl.innerHTML = `<div class="grid-empty-state">게시물을 불러오는 중...</div>`;

  try {
    let targetUser = null;
    let targetUid = null;

    if (state.profile && state.profile.username.toLowerCase() === username.toLowerCase()) {
      targetUser = state.profile;
      targetUid = state.user.uid;
    } else {
      const q = query(collection(db, "users"), where("username", "==", username.toLowerCase()), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        heroName.textContent = "사용자를 찾을 수 없음";
        heroTag.textContent = `@${username}`;
        heroBio.textContent = "존재하지 않거나 삭제된 사용자입니다.";
        gridEl.innerHTML = `<div class="grid-empty-state">등록된 게시물이 없습니다.</div>`;
        actionsBar.innerHTML = "";
        return;
      }
      targetUser = snap.docs[0].data();
      targetUid = snap.docs[0].id;
    }

    heroName.textContent = targetUser.displayName || targetUser.username;
    heroTag.textContent = `@${targetUser.username}`;
    heroBio.textContent = targetUser.bio || "소개글이 없습니다.";
    heroAvatar.textContent = targetUser.avatar || "👤";

    if (targetUser.grade || targetUser.classNum || targetUser.studentNum) {
      heroIdentity.textContent = `${targetUser.grade ? targetUser.grade + "학년 " : ""}${targetUser.classNum ? targetUser.classNum + "반 " : ""}${targetUser.studentNum ? targetUser.studentNum + "번" : ""}`.trim();
      setVisible("profileViewIdentity", true);
    } else {
      setVisible("profileViewIdentity", false);
    }

    // Actions Bar with clean SVG icons
    actionsBar.innerHTML = "";
    if (state.user && state.user.uid === targetUid) {
      const editBtn = document.createElement("button");
      editBtn.className = "primary";
      editBtn.innerHTML = `${SVG.edit} <span>프로필 편집</span>`;
      editBtn.onclick = () => $("myPageDialog").showModal();

      const copyLinkBtn = document.createElement("button");
      copyLinkBtn.className = "ghost";
      copyLinkBtn.innerHTML = `${SVG.link} <span>링크 복사</span>`;
      copyLinkBtn.onclick = () => {
        navigator.clipboard.writeText(`${window.location.origin}/@${targetUser.username}`);
        showToast("프로필 주소가 복사되었습니다! 🔗");
      };

      actionsBar.append(editBtn, copyLinkBtn);
    } else {
      const chatBtn = document.createElement("button");
      chatBtn.className = "primary";
      chatBtn.innerHTML = `${SVG.chat} <span>1:1 대화</span>`;
      chatBtn.onclick = () => {
        openChat(targetUid, targetUser);
        navigateTo("/chat");
      };

      const friendBtn = document.createElement("button");
      friendBtn.className = "ghost";
      const isAlreadyFriend = state.friends?.some((f) => f.uid === targetUid);
      friendBtn.innerHTML = isAlreadyFriend
        ? `${SVG.userCheck} <span>친구 상태</span>`
        : `${SVG.userPlus} <span>친구 추가</span>`;
      if (!isAlreadyFriend) {
        friendBtn.onclick = async () => {
          $("friendUsernameInput").value = targetUser.username;
          await addFriendByUsername();
          friendBtn.innerHTML = `${SVG.userCheck} <span>친구 추가됨</span>`;
        };
      }

      const copyLinkBtn = document.createElement("button");
      copyLinkBtn.className = "ghost";
      copyLinkBtn.innerHTML = `${SVG.link} <span>링크 복사</span>`;
      copyLinkBtn.onclick = () => {
        navigator.clipboard.writeText(`${window.location.origin}/@${targetUser.username}`);
        showToast("프로필 주소가 복사되었습니다! 🔗");
      };

      actionsBar.append(chatBtn, friendBtn, copyLinkBtn);
    }

    // Friend Count
    try {
      const friendsSnap = await getDocs(
        query(collection(db, "friendships"), where("users", "array-contains", targetUid))
      );
      friendCountEl.textContent = friendsSnap.size;
    } catch (e) {
      friendCountEl.textContent = "0";
    }

    // Fetch user posts from Firestore and fallback to server API
    let userPosts = [];
    try {
      const postsQuery = query(
        collection(db, "posts"),
        where("authorUid", "==", targetUid),
        orderBy("createdAt", "desc")
      );
      const postsSnap = await getDocs(postsQuery);
      postsSnap.forEach((d) => userPosts.push({ id: d.id, ...d.data() }));
    } catch (fsErr) {
      console.warn("Firestore profile posts error, checking server:", fsErr);
    }

    if (userPosts.length === 0) {
      try {
        const resp = await fetch("/api/posts");
        if (resp.ok) {
          const all = await resp.json();
          userPosts = all.filter((p) => p.authorUid === targetUid);
        }
      } catch (e) {}
    }

    postCountEl.textContent = userPosts.length;

    if (userPosts.length === 0) {
      gridEl.innerHTML = `<div class="grid-empty-state">아직 등록된 사진이나 글이 없습니다.</div>`;
      return;
    }

    gridEl.innerHTML = "";
    userPosts.forEach((post) => {
      const item = document.createElement("div");
      item.className = "grid-item";

      const likesCount = (post.likes || []).length;
      const commentsCount = post.commentCount || (post.comments || []).length || 0;

      if (post.media) {
        if (post.media.type === "video") {
          const video = document.createElement("video");
          video.src = post.media.url;
          video.muted = true;
          video.preload = "metadata";
          item.appendChild(video);

          const badge = document.createElement("div");
          badge.className = "grid-video-badge";
          badge.innerHTML = `${SVG.videoBadge} <span>동영상</span>`;
          item.appendChild(badge);
        } else {
          const img = document.createElement("img");
          img.src = post.media.url;
          img.alt = "포스트 사진";
          img.loading = "lazy";
          item.appendChild(img);
        }
      } else {
        const textCard = document.createElement("div");
        textCard.style.padding = "16px";
        textCard.style.display = "flex";
        textCard.style.alignItems = "center";
        textCard.style.justifyContent = "center";
        textCard.style.height = "100%";
        textCard.style.textAlign = "center";
        textCard.style.fontSize = "13px";
        textCard.style.lineHeight = "1.4";
        textCard.style.color = "#E2E8F0";
        textCard.textContent = post.content ? post.content.substring(0, 50) + "..." : "게시물";
        item.appendChild(textCard);
      }

      const overlay = document.createElement("div");
      overlay.className = "grid-overlay";
      overlay.innerHTML = `
        <span class="grid-overlay-stat">${SVG.heart(true)} ${likesCount}</span>
        <span class="grid-overlay-stat">${SVG.comment} ${commentsCount}</span>
      `;
      item.appendChild(overlay);

      item.onclick = () => openPostDetail(post);
      gridEl.appendChild(item);
    });
  } catch (err) {
    console.error("loadProfileView error", err);
    gridEl.innerHTML = `<div class="grid-empty-state">게시물을 불러오는 중 오류가 발생했습니다.</div>`;
  }
}

function openPostDetail(post) {
  const container = $("postDetailLayout");
  if (!container) return;

  let date = new Date();
  if (post.createdAt?.toDate) date = post.createdAt.toDate();
  else if (typeof post.createdAt === "string") date = new Date(post.createdAt);
  const timeStr = formatTimeAgo(date);

  const likes = post.likes || [];
  const isLiked = state.user && likes.includes(state.user.uid);

  container.innerHTML = `
    <div class="post-detail-media-side">
      ${
        post.media?.type === "video"
          ? `<video src="${post.media.url}" controls playsinline autoplay muted></video>`
          : post.media?.url
          ? `<img src="${post.media.url}" alt="포스트 이미지" />`
          : `<div style="color:#FFF; padding:20px; text-align:center; font-size:16px;">${post.content || ""}</div>`
      }
    </div>
    <div class="post-detail-info-side">
      <div class="feed-post-header">
        <div class="feed-post-author" id="detailAuthorBtn">
          <div class="post-author-avatar">${post.authorAvatar || "👤"}</div>
          <div>
            <div class="post-author-name">${post.authorName}</div>
            <div class="post-author-username">@${post.authorUsername} · ${timeStr}</div>
          </div>
        </div>
      </div>
      <div class="feed-post-body" style="padding-bottom:16px;">${post.content || ""}</div>
      <div class="feed-post-actions-bar">
        <button type="button" class="action-icon-btn ${isLiked ? "liked" : ""}" id="detailLikeBtn">
          <span class="action-icon">${SVG.heart(isLiked)}</span>
          <span>좋아요 <strong id="detailLikeCount">${likes.length}</strong></span>
        </button>
        <button type="button" class="action-icon-btn" id="detailShareBtn">
          <span class="action-icon">${SVG.share}</span>
          <span>공유</span>
        </button>
      </div>
      <div class="feed-post-comments-wrap" style="flex:1; display:flex; flex-direction:column; overflow:hidden;">
        <div class="comments-list" id="detailCommentsList" style="flex:1; max-height:none;">
          <div class="muted" style="font-size:12px; padding:10px;">댓글을 불러오는 중...</div>
        </div>
        <form class="comment-input-bar" id="detailCommentForm">
          <input type="text" placeholder="댓글 달기..." id="detailCommentInput" required />
          <button type="submit" class="primary">등록</button>
        </form>
      </div>
    </div>
  `;

  $("detailAuthorBtn").onclick = () => {
    $("postDetailDialog").close();
    navigateTo(`/@${post.authorUsername}`);
  };

  $("detailLikeBtn").onclick = async () => {
    await togglePostLike(post.id, likes);
    const updatedLiked = !isLiked;
    $("detailLikeBtn").classList.toggle("liked", updatedLiked);
    $("detailLikeBtn").querySelector(".action-icon").innerHTML = SVG.heart(updatedLiked);
    $("detailLikeCount").textContent = updatedLiked ? likes.length + 1 : Math.max(0, likes.length - 1);
  };

  $("detailShareBtn").onclick = () => {
    navigator.clipboard.writeText(`${window.location.origin}/@${post.authorUsername}`);
    showToast("게시물 작성자 링크가 복사되었습니다! 🔗");
  };

  const list = $("detailCommentsList");
  if (Array.isArray(post.comments) && post.comments.length > 0) {
    list.innerHTML = "";
    post.comments.forEach((c) => {
      let cDate = new Date();
      if (c.createdAt?.toDate) cDate = c.createdAt.toDate();
      else if (typeof c.createdAt === "string") cDate = new Date(c.createdAt);
      const row = document.createElement("div");
      row.className = "comment-row";
      row.innerHTML = `
        <div class="comment-avatar">${c.authorAvatar || "👤"}</div>
        <div class="comment-content">
          <div><strong class="comment-author-name">${c.authorName}</strong> <span class="comment-text">${c.text}</span></div>
          <span class="comment-time">${formatTimeAgo(cDate)}</span>
        </div>
      `;
      list.appendChild(row);
    });
  }

  try {
    const commentsQ = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "asc"));
    const unsubComments = onSnapshot(commentsQ, (snap) => {
      if (!list) return;
      if (!snap.empty) {
        list.innerHTML = "";
        snap.forEach((doc) => {
          const c = doc.data();
          const row = document.createElement("div");
          row.className = "comment-row";
          row.innerHTML = `
            <div class="comment-avatar">${c.authorAvatar || "👤"}</div>
            <div class="comment-content">
              <div><strong class="comment-author-name">${c.authorName}</strong> <span class="comment-text">${c.text}</span></div>
              <span class="comment-time">${formatTimeAgo(c.createdAt?.toDate ? c.createdAt.toDate() : new Date())}</span>
            </div>
          `;
          list.appendChild(row);
        });
      }
    });

    $("postDetailDialog").onclose = () => {
      try { unsubComments(); } catch (e) {}
    };
  } catch (e) {}

  $("detailCommentForm").onsubmit = async (e) => {
    e.preventDefault();
    await submitComment(post.id, $("detailCommentInput"));
  };

  $("closePostDetailBtn").onclick = () => {
    $("postDetailDialog").close();
  };

  $("postDetailDialog").showModal();
}




