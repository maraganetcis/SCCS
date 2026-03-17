import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  profile: null,
  selectedFriend: null,
  unsubscribeChat: null,
};

function showToast(message) {
  $("toast").textContent = message;
}

function threadId(a, b) {
  return [a, b].sort().join("__");
}

function applyTheme(color) {
  document.documentElement.style.setProperty("--accent", color || "#7c5cff");
}

async function upsertProfile(uid, payload) {
  await setDoc(doc(db, "users", uid), payload, { merge: true });
}

async function loadMyProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

async function register() {
  const email = $("emailInput").value.trim();
  const password = $("passwordInput").value;
  const username = $("usernameInput").value.trim().toLowerCase();
  const displayName = $("displayNameInput").value.trim() || username;

  if (!email || !password || !username) {
    showToast("이메일, 비밀번호, 아이디를 입력해주세요.");
    return;
  }

  const existing = await getDocs(query(collection(db, "users"), where("username", "==", username)));
  if (!existing.empty) {
    showToast("이미 사용 중인 아이디입니다.");
    return;
  }

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await upsertProfile(cred.user.uid, {
    username,
    displayName,
    bio: "안녕하세요!",
    avatar: "🙂",
    themeColor: "#7c5cff",
    createdAt: serverTimestamp(),
  });
  showToast("회원가입 완료");
}

async function login() {
  await signInWithEmailAndPassword(auth, $("emailInput").value.trim(), $("passwordInput").value);
  showToast("로그인 성공");
}

async function logout() {
  await signOut(auth);
  showToast("로그아웃됨");
}

async function addFriendByUsername() {
  if (!state.user || !state.profile) return;
  const targetUsername = $("friendUsernameInput").value.trim().toLowerCase();
  if (!targetUsername) return;
  if (targetUsername === state.profile.username) {
    showToast("본인은 추가할 수 없습니다.");
    return;
  }

  const snap = await getDocs(query(collection(db, "users"), where("username", "==", targetUsername)));
  if (snap.empty) {
    showToast("해당 아이디 사용자를 찾을 수 없습니다.");
    return;
  }

  const friend = snap.docs[0];
  await setDoc(doc(db, "friendships", `${state.user.uid}__${friend.id}`), {
    users: [state.user.uid, friend.id],
    usernames: [state.profile.username, targetUsername],
    createdAt: serverTimestamp(),
  });
  showToast("친구가 추가되었습니다.");
  $("friendUsernameInput").value = "";
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
    const data = item.data();
    const friendUid = data.users.find((u) => u !== state.user.uid);
    const friendProfile = await loadMyProfile(friendUid);
    if (!friendProfile) continue;

    const div = document.createElement("button");
    div.className = "friend-item";
    div.innerHTML = `<strong>${friendProfile.avatar || "🙂"} ${friendProfile.displayName}</strong><br/><span class="muted">@${friendProfile.username}</span>`;
    div.onclick = () => openChat(friendUid, friendProfile);
    list.appendChild(div);
  }
}

function renderMessages(docs) {
  const area = $("messageArea");
  area.innerHTML = "";
  docs.forEach((m) => {
    const data = m.data();
    const bubble = document.createElement("div");
    bubble.className = `message ${data.senderUid === state.user.uid ? "me" : "them"}`;
    bubble.textContent = data.text;
    area.appendChild(bubble);
  });
  area.scrollTop = area.scrollHeight;
}

function openChat(friendUid, friendProfile) {
  state.selectedFriend = { uid: friendUid, ...friendProfile };
  $("chatTitle").textContent = `${friendProfile.avatar || "🙂"} ${friendProfile.displayName}`;
  $("chatSubtitle").textContent = friendProfile.bio || "";

  if (state.unsubscribeChat) state.unsubscribeChat();
  const id = threadId(state.user.uid, friendUid);
  const q = query(collection(db, "chats", id, "messages"), orderBy("createdAt", "asc"));
  state.unsubscribeChat = onSnapshot(q, (snap) => renderMessages(snap.docs));
}

async function sendMessage() {
  if (!state.user || !state.selectedFriend) return;
  const input = $("messageInput");
  const text = input.value.trim();
  if (!text) return;
  const id = threadId(state.user.uid, state.selectedFriend.uid);

  await addDoc(collection(db, "chats", id, "messages"), {
    text,
    senderUid: state.user.uid,
    createdAt: serverTimestamp(),
  });
  input.value = "";
}

async function saveProfile() {
  if (!state.user) return;
  const payload = {
    bio: $("bioInput").value.trim() || "",
    themeColor: $("themeInput").value,
    avatar: $("avatarInput").value.trim() || "🙂",
  };
  await upsertProfile(state.user.uid, payload);
  state.profile = { ...state.profile, ...payload };
  bindProfileToUI();
  showToast("프로필 저장 완료");
}

function bindProfileToUI() {
  if (!state.profile) return;
  $("myDisplayName").textContent = state.profile.displayName;
  $("myTag").textContent = `@${state.profile.username}`;
  $("myAvatar").textContent = state.profile.avatar || "🙂";
  $("bioInput").value = state.profile.bio || "";
  $("avatarInput").value = state.profile.avatar || "🙂";
  $("themeInput").value = state.profile.themeColor || "#7c5cff";
  applyTheme(state.profile.themeColor);
}

onAuthStateChanged(auth, async (user) => {
  state.user = user;
  if (!user) {
    state.profile = null;
    $("myDisplayName").textContent = "로그인 필요";
    $("myTag").textContent = "@guest";
    $("friendList").innerHTML = "";
    $("messageArea").innerHTML = "";
    return;
  }

  state.profile = await loadMyProfile(user.uid);
  bindProfileToUI();
  renderFriends();
});

$("signupBtn").onclick = () => register().catch((e) => showToast(e.message));
$("loginBtn").onclick = () => login().catch((e) => showToast(e.message));
$("logoutBtn").onclick = () => logout().catch((e) => showToast(e.message));
$("addFriendBtn").onclick = () => addFriendByUsername().catch((e) => showToast(e.message));
$("sendBtn").onclick = () => sendMessage().catch((e) => showToast(e.message));
$("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage().catch((err) => showToast(err.message));
});
$("openProfileModal").onclick = () => $("profileDialog").showModal();
$("saveProfileBtn").onclick = (e) => {
  e.preventDefault();
  saveProfile().catch((err) => showToast(err.message));
  $("profileDialog").close();
};

showToast("Firebase 설정값을 app.js에 입력해주세요.");
