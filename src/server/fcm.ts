import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import type webpushType from 'web-push';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof webpushType;
import {
  firestoreClient,
  projectId,
  getChannelById,
  getAllUsersList,
  isChannelOpenPublic,
  isFirestoreRestBackoffActive,
  handleFirestoreQuotaOrError,
} from './db.ts';

export interface WebPushSubscriptionData {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface DeviceRecord {
  id: string;
  token: string;
  userId: number | string;
  username?: string;
  deviceId: string;
  platform: 'web' | 'android' | string;
  deviceModel?: string;
  subscription?: WebPushSubscriptionData | null;
  updatedAt: number;
}

const DATA_DIR = path.resolve('data');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push_subscriptions.json');
const VAPID_FILE = path.join(DATA_DIR, 'web_push_vapid.json');
const NOTIFICATIONS_COLLECTION = 'community_notifications';

const deviceTokens = new Map<string, DeviceRecord>();
const recentDispatchedMessages = new Map<string, number>();

let vapidKeysCache: { publicKey: string; privateKey: string } | null = null;
let diskLoaded = false;
let lastFirestoreSyncAt = 0;
const FIRESTORE_SYNC_TTL_MS = 15 * 1000;

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadVapidKeys(): { publicKey: string; privateKey: string } {
  if (vapidKeysCache) return vapidKeysCache;

  const envPub = (process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  if (envPub && envPriv) {
    vapidKeysCache = { publicKey: envPub, privateKey: envPriv };
  } else {
    ensureDataDir();
    if (fs.existsSync(VAPID_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
        if (parsed?.publicKey && parsed?.privateKey) {
          vapidKeysCache = { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
        }
      } catch {}
    }
    if (!vapidKeysCache) {
      vapidKeysCache = webpush.generateVAPIDKeys();
      try {
        fs.writeFileSync(VAPID_FILE, JSON.stringify(vapidKeysCache, null, 2), 'utf8');
      } catch (err) {
        console.warn('[Salim Push] Failed to persist VAPID keys:', err);
      }
    }
  }

  try {
    webpush.setVapidDetails(
      'mailto:notifications@salim-trading.app',
      vapidKeysCache.publicKey,
      vapidKeysCache.privateKey
    );
  } catch (err) {
    console.warn('[Salim Push] setVapidDetails warning:', err);
  }

  return vapidKeysCache;
}

export function getWebPushPublicKey(): string {
  return loadVapidKeys().publicKey;
}

function makeRecordKey(userId: number | string, deviceId: string, token: string): string {
  const cleanDev = String(deviceId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  if (cleanDev) {
    return `fcm_tok_${userId}_${cleanDev}`;
  }
  const hash = crypto.createHash('sha1').update(String(token)).digest('hex').slice(0, 12);
  return `fcm_tok_${userId}_${hash}`;
}

function loadSubscriptionsFromDisk() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && (item.token || item.subscription?.endpoint)) {
            const key =
              item.id || makeRecordKey(item.userId, item.deviceId || '', item.token || item.subscription?.endpoint);
            deviceTokens.set(key, { ...item, id: key });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Salim Push] Failed to read disk push subscriptions:', err);
  }
}

function saveSubscriptionsToDisk() {
  try {
    ensureDataDir();
    const list = Array.from(deviceTokens.values());
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Salim Push] Failed to save disk push subscriptions:', err);
  }
}

async function syncSubscriptionsFromFirestore(): Promise<void> {
  loadSubscriptionsFromDisk();
  if (!firestoreClient || isFirestoreRestBackoffActive()) return;
  if (Date.now() - lastFirestoreSyncAt < FIRESTORE_SYNC_TTL_MS) return;
  lastFirestoreSyncAt = Date.now();

  try {
    const snap = await firestoreClient
      .collection(NOTIFICATIONS_COLLECTION)
      .where('type', '==', 'fcm_device_token')
      .get();

    let changed = false;
    snap.forEach((doc: { id: string; data: () => any }) => {
      const d = doc.data();
      if (!d) return;
      const uid = Number(d.userId || d.senderId || 0);
      if (!uid || uid <= 0) return;
      const sub: WebPushSubscriptionData | null =
        d.subscription && typeof d.subscription === 'object' && d.subscription.endpoint && d.subscription.keys
          ? {
              endpoint: String(d.subscription.endpoint),
              expirationTime: d.subscription.expirationTime ?? null,
              keys: {
                p256dh: String(d.subscription.keys.p256dh || ''),
                auth: String(d.subscription.keys.auth || ''),
              },
            }
          : null;
      const token = String(d.token || sub?.endpoint || '').trim();
      if (!token) return;

      const recordId = String(d.id || doc.id);
      const existing = deviceTokens.get(recordId);
      const updatedAt = Number(d.updatedAt || d.timestamp || Date.now());

      if (!existing || updatedAt >= existing.updatedAt) {
        deviceTokens.set(recordId, {
          id: recordId,
          token,
          userId: uid,
          username: String(d.username || d.senderName || ''),
          deviceId: String(d.deviceId || 'unknown'),
          platform: String(d.platform || (sub ? 'web' : 'android')),
          deviceModel: String(d.deviceModel || ''),
          subscription: sub || existing?.subscription || null,
          updatedAt,
        });
        changed = true;
      }
    });

    if (changed) {
      saveSubscriptionsToDisk();
    }
  } catch (err) {
    handleFirestoreQuotaOrError(err, 'syncSubscriptionsFromFirestore', NOTIFICATIONS_COLLECTION);
  }
}

async function removeDeviceRecord(recordId: string) {
  deviceTokens.delete(recordId);
  saveSubscriptionsToDisk();
  if (firestoreClient && !isFirestoreRestBackoffActive()) {
    try {
      await firestoreClient.collection(NOTIFICATIONS_COLLECTION).doc(recordId).delete();
    } catch {}
  }
}

export async function registerDeviceToken(params: {
  token?: string;
  userId: number | string;
  username?: string;
  deviceId?: string;
  platform?: string;
  deviceModel?: string;
  subscription?: WebPushSubscriptionData | null;
}): Promise<DeviceRecord> {
  loadSubscriptionsFromDisk();

  const uid = Number(params.userId || 0);
  const cleanSub: WebPushSubscriptionData | null =
    params.subscription &&
    typeof params.subscription === 'object' &&
    params.subscription.endpoint &&
    params.subscription.keys?.p256dh &&
    params.subscription.keys?.auth
      ? {
          endpoint: String(params.subscription.endpoint).trim(),
          expirationTime: params.subscription.expirationTime ?? null,
          keys: {
            p256dh: String(params.subscription.keys.p256dh).trim(),
            auth: String(params.subscription.keys.auth).trim(),
          },
        }
      : null;

  const cleanToken = String(params.token || cleanSub?.endpoint || '').trim();
  const cleanDeviceId = String(params.deviceId || 'web_default')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
  const platform = params.platform || (cleanSub ? 'web' : 'android');
  const recordId = makeRecordKey(uid, cleanDeviceId, cleanToken);
  const now = Date.now();

  // Remove stale registrations on the same deviceId or endpoint belonging to another user
  const staleIds: string[] = [];
  for (const [key, rec] of deviceTokens.entries()) {
    if (key === recordId) continue;
    const sameDevice = rec.deviceId && cleanDeviceId && rec.deviceId === cleanDeviceId;
    const sameEndpoint =
      cleanSub?.endpoint &&
      (rec.subscription?.endpoint === cleanSub.endpoint || rec.token === cleanSub.endpoint);
    const sameToken = cleanToken && rec.token === cleanToken;
    if (sameDevice || sameEndpoint || sameToken) {
      staleIds.push(key);
    }
  }
  for (const staleKey of staleIds) {
    await removeDeviceRecord(staleKey);
  }

  const record: DeviceRecord = {
    id: recordId,
    token: cleanToken,
    userId: uid,
    username: params.username || '',
    deviceId: cleanDeviceId,
    platform,
    deviceModel: params.deviceModel || '',
    subscription: cleanSub,
    updatedAt: now,
  };

  deviceTokens.set(recordId, record);
  saveSubscriptionsToDisk();

  if (firestoreClient && !isFirestoreRestBackoffActive()) {
    try {
      await firestoreClient
        .collection(NOTIFICATIONS_COLLECTION)
        .doc(recordId)
        .set(
          {
            id: recordId,
            type: 'fcm_device_token',
            title: 'fcm_token',
            body: '',
            token: cleanToken,
            userId: uid,
            senderId: uid,
            username: params.username || '',
            senderName: params.username || '',
            deviceId: cleanDeviceId,
            platform,
            deviceModel: params.deviceModel || '',
            subscription: cleanSub || null,
            targetUserIds: [],
            timestamp: now,
            updatedAt: now,
            createdAt: now,
          },
          { merge: true }
        );
    } catch (err) {
      handleFirestoreQuotaOrError(err, 'registerDeviceToken', NOTIFICATIONS_COLLECTION);
    }
  }

  return record;
}

export async function unregisterDeviceToken(
  userId: number | string,
  token?: string,
  deviceId?: string
): Promise<void> {
  loadSubscriptionsFromDisk();
  const uid = Number(userId || 0);
  const toDelete: string[] = [];

  for (const [key, rec] of deviceTokens.entries()) {
    const matchesUser = uid > 0 ? Number(rec.userId) === uid : true;
    const matchesToken = token && (rec.token === token || rec.subscription?.endpoint === token);
    const matchesDev = deviceId && rec.deviceId === deviceId;
    if (matchesUser && (matchesToken || matchesDev || (!token && !deviceId))) {
      toDelete.push(key);
    }
  }

  for (const key of toDelete) {
    await removeDeviceRecord(key);
  }
}

async function getGcpAccessToken(): Promise<string | null> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60_000) {
    return cachedAccessToken.token;
  }

  // 1. Try Cloud Run / GCE Metadata Server
  try {
    const res = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1500),
      }
    );
    if (res.ok) {
      const data: any = await res.json();
      if (data?.access_token) {
        cachedAccessToken = {
          token: String(data.access_token),
          expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
        };
        return cachedAccessToken.token;
      }
    }
  } catch {}

  return null;
}

async function sendAndroidFcmV1(
  fcmToken: string,
  payload: {
    title: string;
    body: string;
    data: Record<string, string>;
  }
): Promise<{ ok: boolean; unreg?: boolean }> {
  const accessToken = await getGcpAccessToken();
  if (!accessToken || !projectId) return { ok: false };

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: fcmToken,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            data: payload.data,
            android: {
              priority: 'HIGH',
              notification: {
                channel_id: 'sami_channel_messages_v2',
                click_action: 'OPEN_SAMI_CHAT',
                tag: payload.data.messageId ? `salim-msg-${payload.data.messageId}` : undefined,
              },
            },
          },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    if (res.status === 404 || text.includes('UNREGISTERED')) {
      return { ok: false, unreg: true };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function sendNotificationToUsers(
  targetUserIds: (number | string)[],
  payload: {
    title: string;
    body: string;
    chatType?: string;
    data?: Record<string, string>;
  }
): Promise<{ success: boolean; sentCount: number }> {
  loadVapidKeys();
  await syncSubscriptionsFromFirestore();

  const targetSet = new Set(
    (targetUserIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
  );
  const broadcastAll = targetSet.size === 0;

  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload.data || {})) {
    if (v !== undefined && v !== null) {
      stringData[k] = String(v);
    }
  }
  stringData.title = payload.title;
  stringData.body = payload.body;
  if (payload.chatType && !stringData.chatType) {
    stringData.chatType = payload.chatType;
  }

  const webPayloadJson = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: '/icon-192.png',
    tag: stringData.messageId ? `salim-msg-${stringData.messageId}` : `salim-msg-${Date.now()}`,
    data: stringData,
  });

  const matchingDevices = Array.from(deviceTokens.values()).filter((rec) => {
    const uid = Number(rec.userId || 0);
    return broadcastAll ? uid > 0 : targetSet.has(uid);
  });

  // Deduplicate by endpoint/token so same physical device doesn't get double alerts
  const seenEndpoints = new Set<string>();
  const uniqueDevices: DeviceRecord[] = [];
  for (const rec of matchingDevices) {
    const key = rec.subscription?.endpoint || rec.token;
    if (!key || seenEndpoints.has(key)) continue;
    seenEndpoints.add(key);
    uniqueDevices.push(rec);
  }

  let sentCount = 0;

  await Promise.allSettled(
    uniqueDevices.map(async (rec) => {
      if (rec.subscription?.endpoint && rec.subscription?.keys?.p256dh && rec.subscription?.keys?.auth) {
        try {
          await webpush.sendNotification(
            rec.subscription as webpushType.PushSubscription,
            webPayloadJson,
            {
              TTL: 86400,
              urgency: 'high',
            }
          );
          sentCount += 1;
        } catch (err: any) {
          const code = Number(err?.statusCode || 0);
          if (code === 404 || code === 410) {
            await removeDeviceRecord(rec.id);
          } else {
            console.warn('[Salim WebPush] Delivery warning:', code, err?.message || err);
          }
        }
        return;
      }

      if (rec.platform === 'android' && rec.token && !rec.token.startsWith('https://')) {
        const res = await sendAndroidFcmV1(rec.token, {
          title: payload.title,
          body: payload.body,
          data: stringData,
        });
        if (res.ok) {
          sentCount += 1;
        } else if (res.unreg) {
          await removeDeviceRecord(rec.id);
        }
      }
    })
  );

  return { success: true, sentCount };
}

export async function dispatchAuthorizedChatPush(params: {
  senderId: number | string;
  senderName: string;
  senderRole?: string;
  title?: string;
  chatType: 'private' | 'channel';
  channelId?: string;
  receiverId?: number | string;
  partnerId?: number | string;
  targetUserIds?: (number | string)[];
  messageId: string;
  snippet: string;
}): Promise<{ success: boolean; deliveredCount: number }> {
  const now = Date.now();
  // Clean old dedupe entries
  for (const [msgKey, ts] of recentDispatchedMessages.entries()) {
    if (now - ts > 120_000) recentDispatchedMessages.delete(msgKey);
  }
  const dedupeKey = params.messageId ? `${params.chatType}:${params.messageId}` : '';
  if (dedupeKey) {
    if (recentDispatchedMessages.has(dedupeKey)) {
      return { success: true, deliveredCount: 0 };
    }
    recentDispatchedMessages.set(dedupeKey, now);
  }

  const senderNum = Number(params.senderId || 0);
  const isPrivate = params.chatType === 'private';

  let recipients: number[] = Array.from(
    new Set(
      (params.targetUserIds || [])
        .map((x) => Number(x))
        .filter((x) => x > 0 && x !== senderNum && (isPrivate || x < 9_000_000))
    )
  );

  if (recipients.length === 0) {
    if (isPrivate && params.receiverId) {
      const rNum = Number(params.receiverId);
      if (rNum > 0 && rNum !== senderNum) {
        recipients = [rNum];
      }
    } else if (!isPrivate && params.channelId) {
      try {
        const channel = await getChannelById(params.channelId);
        if (channel) {
          const allUsers = await getAllUsersList();
          if (isChannelOpenPublic(channel)) {
            recipients = allUsers
              .map((u) => Number(u.id))
              .filter((id) => id > 0 && id < 9_000_000 && id !== senderNum);
          } else {
            const allowedSet = new Set<number>(
              (channel.allowedMemberIds || []).map((id) => Number(id))
            );
            for (const u of allUsers) {
              if (u.role === 'owner' || u.id === 1 || u.id === 76 || u.id === 77) {
                allowedSet.add(Number(u.id));
              }
            }
            recipients = Array.from(allowedSet).filter((id) => id > 0 && id !== senderNum);
          }
        }
      } catch {}
    }
  }

  if (recipients.length === 0) {
    return { success: true, deliveredCount: 0 };
  }

  const pushTitle = params.title || params.senderName || 'Salim';
  const pushBody = params.snippet || 'رسالة جديدة';

  const result = await sendNotificationToUsers(recipients, {
    title: pushTitle,
    body: pushBody,
    chatType: params.chatType,
    data: {
      chatType: params.chatType,
      channelId: !isPrivate && params.channelId ? String(params.channelId) : '',
      partnerId: isPrivate ? String(params.partnerId || senderNum || '') : '',
      senderId: String(senderNum || ''),
      senderName: String(params.senderName || 'Salim'),
      messageId: String(params.messageId || ''),
    },
  });

  return { success: true, deliveredCount: result.sentCount };
}
