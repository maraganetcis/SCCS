// **백엔드 서버 주소로 변경하세요!**
// Render 배포 후 얻게 될 주소 (예: https://my-chat-server.onrender.com)
const SERVER_URL = "YOUR_RENDER_SERVER_URL"; 
const socket = io(SERVER_URL);

const form = document.getElementById('form');
const input = document.getElementById('input');
const usernameInput = document.getElementById('username');
const messages = document.getElementById('messages');

// 💡 메시지 전송 처리
form.addEventListener('submit', function(e) {
    e.preventDefault();
    const username = usernameInput.value || '익명';
    const msg = input.value;
    
    if (msg) {
        // 서버로 메시지 객체 전송
        socket.emit('chat message', { 
            text: msg, 
            user: username,
            // 임시로 클라이언트 ID를 사용하여 나의 메시지를 구분
            id: socket.id 
        });
        input.value = '';
    }
});

// 💡 메시지 수신 및 화면 표시
socket.on('chat message', function(data) {
    const item = document.createElement('li');
    
    // 💡 메시지 타입 분류 (카톡 스타일)
    if (data.id === socket.id) {
        item.classList.add('my-message');
    } else {
        item.classList.add('other-message');
        // 상대방 메시지인 경우 이름 표시
        item.innerHTML = `<strong>${data.user}</strong><br>${data.text}`;
    }
    
    // 나의 메시지인 경우 내용만 표시
    if (item.classList.contains('my-message')) {
        item.innerHTML = data.text;
    }
    
    messages.appendChild(item);
    
    // 💡 스크롤을 최신 메시지로 자동 이동 (카톡처럼)
    messages.scrollTop = messages.scrollHeight;
});
