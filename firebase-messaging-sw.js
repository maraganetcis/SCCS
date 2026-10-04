importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js');

// Initialize Firebase in Service Worker
firebase.initializeApp({
  apiKey: "AIzaSyA5FX6asrpW83siWWh-j9kltfIJKsY952o",
  authDomain: "sccs-sct.firebaseapp.com",
  projectId: "sccs-sct",
  storageBucket: "sccs-sct.firebasestorage.app",
  messagingSenderId: "978910466771",
  appId: "1:978910466771:web:e80b2760511fe3107bba26",
  measurementId: "G-4EQDCFMKPP",
});

const messaging = firebase.messaging();

// Handle background messages when tab is closed or in background
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] 백그라운드 푸시 수신:', payload);
  const notificationTitle = payload.notification?.title || payload.data?.title || 'SCCS 새 메시지 🔔';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || '새로운 메시지가 도착했습니다.',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: payload.data?.tag || 'sccs-chat',
    data: payload.data || {},
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const clickAction = event.notification?.data?.click_action || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(clickAction);
      }
    })
  );
});
