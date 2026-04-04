# SCCS (Firebase 기반 프리미엄 웹 채팅)

카카오톡 스타일의 고급형 웹 채팅 UI/UX를 목표로 만든 Firebase 기반 프로젝트입니다. 브랜드명은 SCCS이며 라이트 테마 중심으로 고급스럽게 구성했습니다.

## 기능

- 시작 화면에서 이메일 로그인/회원가입 또는 Google 로그인 (Firebase Auth)
- 로그인 직후 온보딩에서 중복 불가 아이디(`username`) 설정
- 사용자 검색 탭에서 아이디/이름(부분 일치 포함) 검색 후 친구 추가
- 선택한 사용자의 친구 목록 조회
- 친구별 1:1 실시간 채팅 (Firestore)
- 마이페이지
  - 로그아웃
  - 이름 추가/편집
  - 아이디 편집(중복 검사)
  - 상태 메시지/테마/아바타 편집
- 라이트 글래스모피즘 스타일의 반응형 UI

## Firebase 준비

1. Firebase 프로젝트 생성
2. Authentication > Email/Password 활성화
3. Authentication > Google 로그인 제공업체 활성화
4. Firestore Database 생성 (테스트 모드로 시작 후 규칙 강화 권장)
5. `app.js`의 `firebaseConfig`를 실제 값으로 교체


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

## Netlify 배포 시 CSS/JS 캐시 이슈

Netlify에서 이전 CSS가 남아 보일 수 있어 아래를 적용했습니다.
- `index.html`에서 `styles.css?v=4`, `app.js?v=4`로 캐시 버전 적용
- 루트 `_headers` 파일에서 `/index.html`, `/styles.css`, `/app.js`에 `Cache-Control: no-cache` 설정

배포 후에도 동일하면 브라우저 강력 새로고침(모바일 Safari는 방문 기록/웹사이트 데이터 삭제) 후 확인하세요.


## `Missing or insufficient permissions` 해결

이 오류는 거의 항상 Firestore Security Rules에서 읽기/쓰기가 차단될 때 발생합니다.
아래는 개발용(로그인 사용자만 허용) 예시입니다.

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null;
    }

    match /friendships/{id} {
      allow read, write: if request.auth != null;
    }

    match /chats/{chatId}/messages/{messageId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

배포 전에는 반드시 실제 권한 모델(당사자만 접근 가능)로 더 엄격하게 바꾸세요.
