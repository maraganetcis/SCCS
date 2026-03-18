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
const state = { user: null, profile: null, selectedFriend: null, unsubscribeChat: null };

function showToast(message) {
  const toast = $("toast");
  if (toast) {
    toast.textContent = message;
    return;
  }
  console.info("toast:", message);
}

function setVisible(el, visible) {
  const node = $(el);
  node.classList.toggle("hidden", !visible);
  node.hidden = !visible;
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
  if (!state.user) return;
  const username = $("onboardUsername").value.trim().toLowerCase();
  const displayName = $("onboardDisplayName").value.trim();
  if (!username) return showToast("아이디를 입력하세요.");
  if (await usernameTaken(username, state.user.uid)) return showToast("이미 사용 중인 아이디입니다.");

  await upsertProfile(state.user.uid, {
    username,
    displayName: displayName || username,
    bio: "안녕하세요!",
    avatar: "🙂",
    themeColor: "#6e61ff",
    createdAt: serverTimestamp(),
  });
  showToast("아이디 설정 완료");
  await bootApp();
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

async function renderFriends() {
  if (!state.user) return;
  const list = $("friendList");
  list.innerHTML = "";
  const snaps = await getDocs(query(collection(db, "friendships"), where("users", "array-contains", state.user.uid)));
  if (snaps.empty) {
    list.innerHTML = '<p class="muted">아직 친구가 없습니다.</p>';
    return;
  }

  for (const item of snaps.docs) {
    const friendUid = item.data().users.find((u) => u !== state.user.uid);
    const friend = await loadProfile(friendUid);
    if (!friend) continue;
    const btn = document.createElement("button");
    btn.className = "friend-item";
    btn.dataset.uid = friendUid;
    btn.innerHTML = `<strong>${friend.avatar || "🙂"} ${friend.displayName}</strong><br/><span class="muted">@${friend.username}</span>`;
    btn.onclick = () => openChat(friendUid, friend);
    list.appendChild(btn);
  }
}

function openChat(friendUid, friend) {
  state.selectedFriend = { uid: friendUid, ...friend };
  $("chatTitle").textContent = `${friend.avatar || "🙂"} ${friend.displayName}`;
  $("chatSubtitle").textContent = friend.bio || "";

  document.querySelectorAll(".friend-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.uid === friendUid);
  });

  if (state.unsubscribeChat) state.unsubscribeChat();
  const id = threadId(state.user.uid, friendUid);
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt", "asc"));
  state.unsubscribeChat = onSnapshot(q, (snap) => {
    const area = $("messageArea");
    area.innerHTML = "";
    snap.docs.forEach((d) => {
      const m = d.data();
      const bubble = document.createElement("div");
      bubble.className = `message ${m.senderUid === state.user.uid ? "me" : "them"}`;
      bubble.textContent = m.text;
      area.appendChild(bubble);
    });
    area.scrollTop = area.scrollHeight;
  });
}

async function sendMessage() {
  if (!state.user || !state.selectedFriend) return showToast("친구를 먼저 선택하세요.");
  const text = $("messageInput").value.trim();
  if (!text) return;
  const id = threadId(state.user.uid, state.selectedFriend.uid);
  await addDoc(collection(db, "chats", id, "messages"), {
    text,
    senderUid: state.user.uid,
    createdAt: serverTimestamp(),
  });
  $("messageInput").value = "";
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
  showToast("Google 로그인 처리 중 오류가 발생했습니다.");
});

$("signupBtn").onclick = () => registerWithEmail().catch((e) => showToast(e.message));
$("loginBtn").onclick = () => loginWithEmail().catch((e) => showToast(e.message));
$("googleBtn").onclick = () => loginWithGoogle().catch((e) => showToast(e.message));
$("completeOnboardingBtn").onclick = () => completeOnboarding().catch((e) => showToast(e.message));
$("addFriendBtn").onclick = () => addFriendByUsername().catch((e) => showToast(e.message));
$("sendBtn").onclick = () => sendMessage().catch((e) => showToast(e.message));
$("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage().catch((err) => showToast(err.message));
});
$("openMyPage").onclick = () => $("myPageDialog").showModal();
$("saveIdentityBtn").onclick = (e) => {
  e.preventDefault();
  saveIdentity().catch((err) => showToast(err.message));
};
$("saveProfileBtn").onclick = (e) => {
  e.preventDefault();
  saveProfile().catch((err) => showToast(err.message));
};
$("logoutBtn").onclick = async (e) => {
  e.preventDefault();
  await signOut(auth);
  $("myPageDialog").close();
};
