# SCCS (Firebase 기반 프리미엄 웹 채팅)

카카오톡 스타일의 고급형 웹 채팅 UI/UX를 목표로 만든 Firebase 기반 프로젝트입니다. 브랜드명은 SCCS이며 라이트 테마 중심으로 고급스럽게 구성했습니다.

## 기능

- 이메일/비밀번호 회원가입 & 로그인 (Firebase Auth)
- 고유 아이디(`username`) 기반 친구 추가
- 친구별 1:1 실시간 채팅 (Firestore)
- 프로필 꾸미기
  - 상태 메시지
  - 테마 컬러
  - 이모지 아바타
- 라이트 글래스모피즘 스타일의 반응형 UI

## Firebase 준비

1. Firebase 프로젝트 생성
2. Authentication > Email/Password 활성화
3. Firestore Database 생성 (테스트 모드로 시작 후 규칙 강화 권장)
4. `app.js`의 `firebaseConfig`를 실제 값으로 교체

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

## 실행

정적 파일이므로 간단한 로컬 서버로 실행합니다.

```bash
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173` 접속.

## Firestore 데이터 구조

- `users/{uid}`: 사용자 프로필
- `friendships/{uidA__uidB}`: 친구 관계
- `chats/{threadId}/messages/{messageId}`: 메시지

`threadId = [uidA, uidB].sort().join("__")`

## 보안 권장사항

- 프로덕션에서는 Firestore Security Rules로 다음을 강제하세요.
  - 본인 `users/{uid}`만 쓰기
  - `friendships`는 양 당사자만 읽기/쓰기
  - `chats/*/messages`는 대화 참여자만 읽기/쓰기
- 프론트엔드 노출 키는 비밀이 아니지만, 규칙 설정이 필수입니다.
