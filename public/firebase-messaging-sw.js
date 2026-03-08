importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyB_bSeHflIDhihDhDUE1p1kKZpJId0dxA8",
  authDomain:        "medicare-c6196.firebaseapp.com",
  projectId:         "medicare-c6196",
  storageBucket:     "medicare-c6196.firebasestorage.app",
  messagingSenderId: "632103735569",
  appId:             "1:632103735569:web:458561690c6c4c6efbbcb0",
});

const messaging = firebase.messaging();

// This handles notifications when the app is CLOSED or in background
messaging.onBackgroundMessage((payload) => {
  const { title, body, type, tag, payload: innerPayload } = payload.data || {};
  const isCall = type === 'call';

  self.registration.showNotification(title || 'Nursing Hub', {
    body:              body || '',
    icon:              '/favicon.ico',
    badge:             '/favicon.ico',
    tag:               tag || 'notif',
    renotify:          true,
    requireInteraction: isCall,
    vibrate:           isCall ? [300,100,300,100,300,100,300] : [200,100,200],
    data:              { type, payload: innerPayload ? JSON.parse(innerPayload) : {} },
    actions: isCall
      ? [{ action: 'answer', title: '✅ Answer' }, { action: 'decline', title: '❌ Decline' }]
      : [],
  });
});

// Notification click handler
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const type    = e.notification.data?.type || 'general';
  const action  = e.action;
  const payload = e.notification.data?.payload || {};

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      let msg = 'OPEN_APP';
      if (type === 'dm' || type === 'call') msg = 'OPEN_MESSAGES';
      if (type === 'call' && action === 'answer') msg = 'ANSWER_CALL';
      if (type === 'call' && action === 'decline') msg = 'DECLINE_CALL';

      for (const c of cs) {
        if ('focus' in c) { c.postMessage({ type: msg, payload }); return c.focus(); }
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
