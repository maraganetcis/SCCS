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
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

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
const state = { user: null, profile: null, selectedFriend: null, unsubscribeChat: null, pendingImage: null };

function showToast(message) {
  const toast = $("toast");
  if (toast) {
    toast.textContent = message;
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
let audioCtx = null;
let titleInterval = null;
const originalDocTitle = document.title || "SCCS - 신촌중학교 채팅서비스";
const friendListeners = new Map();

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
    badge.textContent = "알림 켜짐 🔔";
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
    return true;
  }
  try {
    const permission = await Notification.requestPermission();
    updateNotifStatusBadge();
    if (permission === "granted") {
      playNotificationSound();
      showToast("알림이 성공적으로 활성화되었습니다! 🔔");
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

function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
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
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("이미지 파일만 전송할 수 있습니다.");
    return;
  }
  showToast("사진 준비 중... ⏳");
  try {
    const compressed = await compressImage(file);
    state.pendingImage = compressed;
    $("previewThumbImg").src = compressed;
    setVisible("imagePreviewBar", true);
    showToast("사진이 준비되었습니다. 전송을 누르세요! 📷");
  } catch (err) {
    console.error("image-process-failed", err);
    showToast("사진 처리에 실패했습니다. 다른 사진을 시도해주세요.");
  }
}

function clearPendingImage() {
  state.pendingImage = null;
  setVisible("imagePreviewBar", false);
  $("previewThumbImg").src = "";
  const fileInput = $("imageFileInput");
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
              const notifMsg = m.imageUrl && !m.text ? "📷 [사진을 보냈습니다]" : (m.text || "사진");
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

function openChat(friendUid, friend) {
  state.selectedFriend = { uid: friendUid, ...friend };
  $("chatTitle").textContent = `${friend.avatar || "🙂"} ${friend.displayName}`;
  $("chatSubtitle").textContent = friend.bio || "";
  clearPendingImage();

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
      
      if (m.imageUrl) {
        const img = document.createElement("img");
        img.src = m.imageUrl;
        img.className = "chat-img";
        img.alt = "사진";
        img.loading = "lazy";
        img.onclick = () => openLightbox(m.imageUrl);
        bubble.appendChild(img);
      }
      if (m.text) {
        const textSpan = document.createElement("div");
        textSpan.textContent = m.text;
        if (m.imageUrl) textSpan.style.marginTop = "6px";
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
            const notifMsg = m.imageUrl && !m.text ? "📷 [사진을 보냈습니다]" : (m.text || "사진");
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
  const text = $("messageInput").value.trim();
  const imageUrl = state.pendingImage;
  if (!text && !imageUrl) return;

  const id = threadId(state.user.uid, state.selectedFriend.uid);
  clearPendingImage();
  $("messageInput").value = "";

  const payload = {
    senderUid: state.user.uid,
    createdAt: serverTimestamp(),
  };
  if (text) payload.text = text;
  if (imageUrl) payload.imageUrl = imageUrl;

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
  setVisible("authGate", false);
  setVisible("usernameGate", false);
  setVisible("appShell", true);
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

$("googleBtn").onclick = () => loginWithGoogle().catch((e) => showGateError(friendlyErrorMessage(e)));
$("completeOnboardingBtn").onclick = () => completeOnboarding().catch((e) => showGateError(friendlyErrorMessage(e)));
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

// Image Attachment & Drag & Drop & Paste Listeners
const attachBtn = $("attachImgBtn");
const imgInput = $("imageFileInput");
const cancelImgBtn = $("cancelImageBtn");
const closeLightBtn = $("closeLightboxBtn");
const lightboxDialog = $("imageLightbox");

if (attachBtn && imgInput) {
  attachBtn.onclick = () => imgInput.click();
  imgInput.onchange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleImageFile(e.target.files[0]);
    }
  };
}

if (cancelImgBtn) {
  cancelImgBtn.onclick = () => clearPendingImage();
}

if (closeLightBtn) {
  closeLightBtn.onclick = () => closeLightbox();
}

if (lightboxDialog) {
  lightboxDialog.onclick = (e) => {
    if (e.target === lightboxDialog) closeLightbox();
  };
}

// Clipboard Paste Image (Ctrl+V / Cmd+V)
window.addEventListener("paste", (e) => {
  if (!state.selectedFriend) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) handleImageFile(file);
      break;
    }
  }
});

// Drag & Drop Image into Chat
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
    if (files && files.length > 0 && files[0].type.startsWith("image/")) {
      handleImageFile(files[0]);
    }
  });
}

