// Firebase Messaging Service Worker for background push notifications
/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const recentMessageIds = [];

self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    data = {
      title: 'Salim',
      body: event.data ? event.data.text() : 'وصلتك رسالة جديدة',
    };
  }

  const payloadData = (data && typeof data.data === 'object' && data.data) ? data.data : data;
  const messageId = payloadData && payloadData.messageId ? String(payloadData.messageId) : '';

  if (messageId) {
    if (recentMessageIds.includes(messageId)) {
      return;
    }
    recentMessageIds.push(messageId);
    if (recentMessageIds.length > 60) {
      recentMessageIds.shift();
    }
  }

  const title =
    payloadData.title ||
    data.title ||
    (data.notification && data.notification.title) ||
    'Salim';
  const body =
    payloadData.body ||
    data.body ||
    (data.notification && data.notification.body) ||
    'وصلتك رسالة جديدة';

  const resolvedChatType =
    payloadData.chatType === 'private' || payloadData.type === 'private_message'
      ? 'private'
      : 'channel';
  const resolvedPartnerId =
    resolvedChatType === 'private'
      ? Number(payloadData.partnerId || payloadData.senderId || 0) || payloadData.partnerId || payloadData.senderId || ''
      : '';

  const options = {
    body,
    icon: payloadData.icon || data.icon || '/icon-192.png',
    badge: '/favicon.png',
    vibrate: [200, 100, 200],
    requireInteraction: false,
    data: {
      chatType: resolvedChatType,
      channelId: resolvedChatType === 'channel' ? (payloadData.channelId || '') : '',
      partnerId: resolvedPartnerId,
      senderId: payloadData.senderId ? Number(payloadData.senderId) || payloadData.senderId : '',
      senderName: payloadData.senderName || '',
      messageId,
      fromNotification: true,
    },
    tag: messageId ? `salim-msg-${messageId}` : (data.tag || `salim-msg-${Date.now()}`),
    renotify: !messageId,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const deepLinkParam = encodeURIComponent(JSON.stringify(notifData));
  const targetUrl = `/?salim_deeplink=${deepLinkParam}`;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        try {
          if (new URL(client.url).origin !== self.location.origin) continue;
        } catch {}
        if ('focus' in client) {
          const focused = await client.focus();
          (focused || client).postMessage({
            type: 'app_open_chat_message',
            detail: notifData,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
