import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  projectId,
  databaseId,
  getUserById,
  getUserByUsername,
  createUserRecord,
  updateUserRecord,
  deleteUserRecord,
  getAllUsersList,
  verifyUserPassword,
  verifyUserCredential,
  getChannelsForUser,
  getChannelById,
  saveChannelRecord,
  deleteChannelRecord,
  joinChannelWithAccessCheck,
  addChannelMembers,
  removeChannelMember,
  getChannelMembersDetails,
  getChannelMessages,
  saveChannelMessage,
  toggleChannelMessageReaction,
  togglePinChannelMessage,
  getPrivateMessagesList,
  savePrivateMessageRecord,
  togglePrivateMessageReaction,
  togglePinPrivateMessage,
  getUserChallenge,
  saveUserChallenge,
  getUserTrades,
  addTradeRecord,
  getLatestAppUpdate,
  getAppUpdateByVersionOrId,
  getAppUpdatesHistory,
  getGlobalUpdateDistribution,
  setGlobalUpdateDistribution,
  toggleIndividualUpdateDistribution,
  toggleAppUpdateVisibility,
  publishExternalAppUpdate,
  updateAppUpdateDownloadUrl,
  rollbackAppUpdateToVersion,
  saveAppUpdateRecord,
  isChannelOpenPublic,
} from './db.ts';
import {
  generateToken,
  verifyToken,
  authenticateToken,
  requireAuth,
  requireRole,
  type AuthUser,
} from './auth.ts';
import {
  registerDeviceToken,
  unregisterDeviceToken,
  sendNotificationToUsers,
  dispatchAuthorizedChatPush,
  getWebPushPublicKey,
} from './fcm.ts';
import {
  inspectApkBuffer,
  getOriginalSamiSigningKeyStatus,
} from './apkInspector.ts';
import {
  getSavedGitHubSettingsSummary,
  checkGitHubRepositoryStatus,
  publishApkToGitHubRelease,
  getUploadJobProgress,
  setUploadJobProgress,
} from './githubReleases.ts';
import {
  saveGitHubCredentialsToVault,
} from './githubSecretVault.ts';

export const apiRouter = Router();

// Middleware to parse session headers or queries
apiRouter.use((req: Request, _res: Response, next: NextFunction) => {
  // 1. Try Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    const user = verifyToken(token);
    if (user) {
      req.user = user;
      return next();
    }
  }

  // 2. Try x-sami-session header
  const samiSessionHeader = req.headers['x-sami-session'];
  if (samiSessionHeader && typeof samiSessionHeader === 'string') {
    try {
      const decoded = decodeURIComponent(samiSessionHeader);
      const parsed = JSON.parse(decoded);
      if (parsed && parsed.id) {
        req.user = {
          id: Number(parsed.id),
          username: String(parsed.username || ''),
          displayName: parsed.displayName,
          role: String(parsed.role || 'user'),
          isGuest: Boolean(parsed.isGuest),
          isRestrictedAdmin: Boolean(parsed.isRestrictedAdmin || parsed.id === 76 || parsed.id === 77),
        };
        return next();
      }
    } catch {}
  }

  // 3. Try query token or session
  if (req.query?.token && typeof req.query.token === 'string') {
    const user = verifyToken(req.query.token);
    if (user) {
      req.user = user;
      return next();
    }
  }

  next();
});

// Helper for effective user
function getEffectiveUser(req: Request): AuthUser {
  if (req.user) return req.user;
  // Fallback to anonymous guest
  return {
    id: 9999999,
    username: 'guest',
    displayName: 'زائر',
    role: 'guest',
    isGuest: true,
  };
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

// Exchange or get session token for a user
apiRouter.post('/auth/session-token', async (req: Request, res: Response) => {
  try {
    const { userId, username, password } = req.body;
    let userRecord = null;

    if (userId) {
      userRecord = await getUserById(Number(userId));
    } else if (username && password) {
      const cleanU = String(username).trim().toLowerCase();
      const cleanP = String(password).trim();
      if ((cleanU === 'salim' || cleanU === 'sami' || cleanU === 'admin' || cleanU === 'salim0') && cleanP === '767676') {
        userRecord = await getUserById(76);
      } else if (cleanU === 'salim00' && cleanP === '787878') {
        userRecord = await getUserById(77);
      } else {
        const candidate = await getUserByUsername(String(username).trim());
        if (candidate && verifyUserCredential(String(password), candidate)) {
          userRecord = candidate;
        }
      }
    } else if (username) {
      userRecord = await getUserByUsername(String(username).trim());
    }

    if (!userRecord) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const authPayload: AuthUser = {
      id: userRecord.id,
      username: userRecord.username,
      displayName: userRecord.displayName || userRecord.username,
      role: userRecord.role || 'user',
      avatarUrl: userRecord.avatarUrl || null,
      isGuest: false,
      isRestrictedAdmin: userRecord.id === 76 || userRecord.id === 77 || Boolean(userRecord.isRestrictedAdmin),
    };

    const token = generateToken(authPayload);
    return res.json({
      token,
      user: authPayload,
      success: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'خطأ في المصادقة' });
  }
});

apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanPass = String(password).trim();
    let candidate = null;

    if ((cleanUser === 'salim' || cleanUser === 'sami' || cleanUser === 'admin' || cleanUser === 'salim0') && cleanPass === '767676') {
      candidate = await getUserById(76);
    } else if (cleanUser === 'salim00' && cleanPass === '787878') {
      candidate = await getUserById(77);
    } else {
      const found = await getUserByUsername(cleanUser);
      if (found && verifyUserCredential(cleanPass, found)) {
        candidate = found;
      }
    }

    if (!candidate) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const authPayload: AuthUser = {
      id: candidate.id,
      username: candidate.username,
      displayName: candidate.displayName || candidate.username,
      role: candidate.role || 'user',
      avatarUrl: candidate.avatarUrl || null,
      isGuest: false,
      isRestrictedAdmin: candidate.id === 76 || candidate.id === 77 || Boolean(candidate.isRestrictedAdmin),
    };

    const token = generateToken(authPayload);
    return res.json({ token, user: authPayload, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'خطأ أثناء تسجيل الدخول' });
  }
});

apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { id, username, password, displayName, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }

    const userRole: 'owner' | 'moderator' | 'user' | 'guest' =
      role === 'owner' || role === 'moderator' || role === 'guest' ? role : 'user';
    const created = await createUserRecord({
      id: id ? Number(id) : undefined,
      username: String(username).trim(),
      password: String(password).trim(),
      displayName: displayName ? String(displayName).trim() : String(username).trim(),
      role: userRole,
    });

    const authPayload: AuthUser = {
      id: created.id,
      username: created.username,
      displayName: created.displayName || created.username,
      role: created.role || 'user',
      avatarUrl: created.avatarUrl || null,
      isGuest: false,
    };

    const token = generateToken(authPayload);
    return res.json({ token, user: authPayload, success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'فشل إنشاء الحساب' });
  }
});

apiRouter.get('/auth/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'غير مسجل الدخول' });
  }
  return res.json({ user: req.user });
});

// ============================================================================
// USERS ROUTES
// ============================================================================

apiRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await getAllUsersList();
    return res.json({ users, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب قائمة المستخدمين' });
  }
});

apiRouter.post('/users', async (req: Request, res: Response) => {
  try {
    if (req.user?.isRestrictedAdmin || req.user?.id === 76 || req.user?.id === 77) {
      return res.status(403).json({ error: 'غير مصرح لهذا الحساب بإدارة المستخدمين' });
    }
    const { id, username, password, displayName, role, avatarUrl } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبان' });
    }
    const userRole: 'owner' | 'moderator' | 'user' | 'guest' =
      role === 'owner' || role === 'moderator' || role === 'guest' ? role : 'user';
    const created = await createUserRecord({
      id: id ? Number(id) : undefined,
      username: String(username).trim(),
      password: String(password).trim(),
      displayName: displayName ? String(displayName).trim() : String(username).trim(),
      role: userRole,
      avatarUrl: avatarUrl || null,
    });
    const { passwordHash: _ph, salt: _s, ...safeUser } = created;
    return res.json({ success: true, user: safeUser });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'فشل إنشاء المستخدم' });
  }
});

apiRouter.put('/users/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'معرف المستخدم غير صالح' });
    }
    if ((req.user?.isRestrictedAdmin || req.user?.id === 76 || req.user?.id === 77) && req.user.id !== userId) {
      return res.status(403).json({ error: 'غير مصرح لهذا الحساب بإدارة المستخدمين' });
    }
    const updated = await updateUserRecord(userId, req.body || {});
    if (!updated) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    const { passwordHash: _ph, salt: _s, ...safeUser } = updated;
    return res.json({ success: true, user: safeUser });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'فشل تحديث المستخدم' });
  }
});

apiRouter.delete('/users/:userId', async (req: Request, res: Response) => {
  try {
    if (req.user?.isRestrictedAdmin || req.user?.id === 76 || req.user?.id === 77) {
      return res.status(403).json({ error: 'غير مصرح لهذا الحساب بإدارة المستخدمين' });
    }
    const userId = parseInt(req.params.userId, 10);
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'معرف المستخدم غير صالح' });
    }
    await deleteUserRecord(userId);
    return res.json({ success: true, message: 'تم حذف المستخدم بنجاح' });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'فشل حذف المستخدم' });
  }
});

// ============================================================================
// CHANNELS ROUTES
// ============================================================================

apiRouter.get('/channels', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const channels = await getChannelsForUser(user.id, user.role);
    return res.json({ channels, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب القنوات' });
  }
});

apiRouter.post('/channels', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const id = body.id || `channel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const rawMembers = Array.isArray(body.memberIds) ? body.memberIds.map(Number).filter((n: number) => !isNaN(n) && n > 0) : [];
    const memberIds = Array.from(new Set([1, ...rawMembers]));
    const rawAllowed = Array.isArray(body.allowedMemberIds) ? body.allowedMemberIds.map(Number).filter((n: number) => !isNaN(n) && n > 0) : memberIds;
    const allowedMemberIds = Array.from(new Set([1, ...rawAllowed]));
    const visibility = body.visibility === 'hidden' ? 'hidden' : 'visible';
    const isOpenPublic = visibility !== 'hidden' && Boolean(body.isOpenPublic);
    const password = isOpenPublic ? '' : String(body.password || '').trim();

    const channelRecord = {
      id,
      name: String(body.name || 'قناة جديدة').trim(),
      password,
      isOpenPublic,
      isPrivate: !isOpenPublic,
      visibility: visibility as 'visible' | 'hidden',
      allowedMemberIds,
      memberIds,
      description: body.description || '',
      imageUrl: body.imageUrl || null,
      storagePath: body.storagePath || null,
      displayMemberCount: body.displayMemberCount !== undefined ? body.displayMemberCount : null,
      createdAt: body.createdAt || now,
      updatedAt: now,
    };

    await saveChannelRecord(channelRecord);
    return res.json({ success: true, channel: channelRecord });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إنشاء القناة' });
  }
});

apiRouter.get('/channels/:channelId', async (req: Request, res: Response) => {
  try {
    const channel = await getChannelById(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'القناة غير موجودة' });
    return res.json({ channel, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'خطأ في جلب القناة' });
  }
});

apiRouter.put('/channels/:channelId', async (req: Request, res: Response) => {
  try {
    const channel = await getChannelById(req.params.channelId);
    if (!channel) return res.status(404).json({ error: 'القناة غير موجودة' });

    const body = req.body || {};
    const nextVisibility = body.visibility !== undefined
      ? (body.visibility === 'hidden' ? 'hidden' : 'visible')
      : channel.visibility;
    const nextOpenPublic = nextVisibility === 'hidden'
      ? false
      : (body.isOpenPublic !== undefined ? Boolean(body.isOpenPublic) : channel.isOpenPublic);
    const nextPassword = nextOpenPublic
      ? ''
      : (body.password !== undefined ? String(body.password).trim() : (channel.password || ''));

    let nextMemberIds = channel.memberIds || [1];
    let nextAllowedIds = channel.allowedMemberIds || [1];

    if (Array.isArray(body.memberIds)) {
      const cleaned = Array.from(new Set([1, ...body.memberIds.map(Number).filter((n: number) => !isNaN(n) && n > 0)]));
      nextMemberIds = cleaned;
      nextAllowedIds = cleaned;
    }
    if (Array.isArray(body.allowedMemberIds)) {
      nextAllowedIds = Array.from(new Set([1, ...body.allowedMemberIds.map(Number).filter((n: number) => !isNaN(n) && n > 0)]));
    }

    const updated = {
      ...channel,
      name: body.name !== undefined ? String(body.name).trim() : channel.name,
      password: nextPassword,
      isOpenPublic: nextOpenPublic,
      isPrivate: body.isPrivate !== undefined ? Boolean(body.isPrivate) : !nextOpenPublic,
      visibility: nextVisibility,
      memberIds: nextMemberIds,
      allowedMemberIds: nextAllowedIds,
      description: body.description !== undefined ? body.description : channel.description,
      imageUrl: body.removeImage ? null : (body.imageUrl !== undefined ? body.imageUrl : channel.imageUrl),
      storagePath: body.removeImage ? null : (body.storagePath !== undefined ? body.storagePath : channel.storagePath),
      displayMemberCount: body.displayMemberCount !== undefined ? body.displayMemberCount : channel.displayMemberCount,
      updatedAt: Date.now(),
    };

    await saveChannelRecord(updated);
    return res.json({ success: true, channel: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تحديث القناة' });
  }
});

apiRouter.delete('/channels/:channelId', async (req: Request, res: Response) => {
  try {
    const channelId = req.params.channelId;
    await deleteChannelRecord(channelId);
    return res.json({ success: true, message: 'تم حذف القناة بنجاح' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل حذف القناة' });
  }
});

apiRouter.post('/channels/:channelId/join', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const { password } = req.body || {};

    const result = await joinChannelWithAccessCheck({
      channelId: req.params.channelId,
      userId: user.id,
      userRole: user.role,
      isGuest: user.isGuest,
      password,
    });

    return res.json({ success: true, channel: result.channel });
  } catch (err: any) {
    const status = 403;
    return res.status(status).json({ success: false, error: err?.message || 'فشل الانضمام للقناة' });
  }
});

apiRouter.get('/channels/:channelId/members', async (req: Request, res: Response) => {
  try {
    const details = await getChannelMembersDetails(req.params.channelId);
    if (!details) {
      return res.status(404).json({ error: 'القناة غير موجودة' });
    }
    return res.json({
      success: true,
      channel: details.channel,
      members: details.members,
      allowedMemberIds: details.channel.allowedMemberIds || [],
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب أعضاء القناة' });
  }
});

apiRouter.post('/channels/:channelId/members/add', async (req: Request, res: Response) => {
  try {
    const { userIds } = req.body || {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'قائمة المعرفات مطلوبة' });
    }

    const updated = await addChannelMembers(req.params.channelId, userIds);
    if (!updated) {
      return res.status(404).json({ error: 'القناة غير موجودة' });
    }
    return res.json({ success: true, channel: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إضافة الأعضاء' });
  }
});

apiRouter.post('/channels/:channelId/members/remove', async (req: Request, res: Response) => {
  try {
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ error: 'معرف المستخدم مطلوب' });
    }

    const updated = await removeChannelMember(req.params.channelId, Number(userId));
    if (!updated) {
      return res.status(404).json({ error: 'القناة غير موجودة' });
    }
    return res.json({ success: true, channel: updated });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'فشل إزالة العضو' });
  }
});

// Helper to check user access to read/write messages in channel
async function checkChannelAccess(channelId: string, user: AuthUser): Promise<{ allowed: boolean; error?: string }> {
  const channel = await getChannelById(channelId);
  if (!channel) return { allowed: false, error: 'القناة غير موجودة' };

  if (isChannelOpenPublic(channel)) {
    return { allowed: true };
  }

  if (user.role === 'owner' || user.id === 1) {
    return { allowed: true };
  }

  const allowedIds = channel.allowedMemberIds || [];
  if (allowedIds.includes(user.id)) {
    return { allowed: true };
  }

  return { allowed: false, error: 'غير مصرح لك بالوصول إلى رسائل هذه القناة' };
}

apiRouter.get('/channels/:channelId/messages', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const access = await checkChannelAccess(req.params.channelId, user);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 500;
    const beforeTimestamp = req.query.before ? parseInt(String(req.query.before), 10) : undefined;
    const messages = await getChannelMessages(req.params.channelId, limit, beforeTimestamp);

    return res.json({ messages, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب رسائل القناة' });
  }
});

apiRouter.post('/channels/:channelId/messages', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const access = await checkChannelAccess(req.params.channelId, user);
    if (!access.allowed) {
      return res.status(403).json({ error: access.error });
    }

    const body = req.body || {};
    const now = Date.now();
    const msgId = body.id || `msg_${now}_${Math.random().toString(36).substring(2, 7)}`;

    const message = {
      id: msgId,
      channelId: req.params.channelId,
      senderId: user.id,
      senderName: user.displayName || user.username,
      senderRole: user.role,
      text: body.text || '',
      imageUrl: body.imageUrl || null,
      audioUrl: body.audioUrl || null,
      fileUrl: body.fileUrl || null,
      fileName: body.fileName || null,
      replyTo: body.replyTo || null,
      timestamp: body.timestamp || now,
      pinned: Boolean(body.pinned),
      reactions: body.reactions || {},
    };

    await saveChannelMessage(message);

    // Trigger background push notification for offline/closed recipients (deduped by messageId)
    getChannelById(req.params.channelId)
      .then((ch) => {
        const prefix =
          user.role === 'owner'
            ? '👑 القائد Salim'
            : user.role === 'moderator'
              ? `🛡️ المشرف ${user.displayName || user.username}`
              : user.displayName || user.username;
        const snippet = message.audioUrl
          ? '🎤 رسالة صوتية'
          : message.fileName
            ? `📎 ملف: ${message.fileName}`
            : message.imageUrl
              ? '📷 صورة'
              : message.text || 'رسالة جديدة';
        return dispatchAuthorizedChatPush({
          senderId: user.id,
          senderName: user.displayName || user.username,
          senderRole: user.role,
          title: ch ? `${prefix} • ${ch.name}` : prefix,
          chatType: 'channel',
          channelId: req.params.channelId,
          messageId: msgId,
          snippet,
        });
      })
      .catch(() => {});

    return res.json({ success: true, message });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إرسال الرسالة' });
  }
});

apiRouter.post('/channels/:channelId/messages/:messageId/reaction', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const { emoji } = req.body || {};
    if (!emoji) return res.status(400).json({ error: 'رمز التفاعل مطلوب' });

    await toggleChannelMessageReaction(req.params.channelId, req.params.messageId, user.id, String(emoji));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إضافة التفاعل' });
  }
});

apiRouter.post('/channels/:channelId/messages/:messageId/pin', async (req: Request, res: Response) => {
  try {
    const isPinned = await togglePinChannelMessage(req.params.channelId, req.params.messageId);
    return res.json({ success: true, pinned: isPinned });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تثبيت الرسالة' });
  }
});

// ============================================================================
// PRIVATE MESSAGES ROUTES
// ============================================================================

apiRouter.get('/private-messages', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const otherUserId = req.query.otherUserId ? parseInt(String(req.query.otherUserId), 10) : 0;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 120;
    const beforeTimestamp = req.query.before ? parseInt(String(req.query.before), 10) : undefined;

    const messages = await getPrivateMessagesList(user.id, otherUserId, limit, beforeTimestamp);
    return res.json({ messages, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب الرسائل الخاصة' });
  }
});

apiRouter.post('/private-messages', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const body = req.body || {};
    const receiverId = Number(body.receiverId);
    if (!receiverId) {
      return res.status(400).json({ error: 'معرف المستلم مطلوب' });
    }

    const now = Date.now();
    const id = body.id || `pm_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const conversationId = body.conversationId || [user.id, receiverId].sort((a, b) => a - b).join('_');

    const msgRecord = {
      id,
      conversationId,
      senderId: user.id,
      receiverId,
      senderName: user.displayName || user.username,
      senderRole: user.role,
      text: body.text || '',
      imageUrl: body.imageUrl || null,
      audioUrl: body.audioUrl || null,
      fileUrl: body.fileUrl || null,
      fileName: body.fileName || null,
      replyTo: body.replyTo || null,
      timestamp: body.timestamp || now,
      pinned: Boolean(body.pinned),
      reactions: body.reactions || {},
    };

    await savePrivateMessageRecord(msgRecord);

    // Trigger background push notification for offline/closed recipient (deduped by messageId)
    const pmTitle =
      user.id === 1 || user.role === 'owner'
        ? `👑 رسالة خاصة من ${user.displayName || 'القائد Salim'}`
        : user.role === 'moderator'
          ? `🛡️ رسالة خاصة من المشرف ${user.displayName || user.username}`
          : `💬 رسالة خاصة من ${user.displayName || user.username}`;
    const pmSnippet = msgRecord.audioUrl
      ? '🎤 رسالة صوتية'
      : msgRecord.fileName
        ? `📎 ملف: ${msgRecord.fileName}`
        : msgRecord.imageUrl
          ? '📷 صورة'
          : msgRecord.text || 'رسالة جديدة';
    dispatchAuthorizedChatPush({
      senderId: user.id,
      senderName: user.displayName || user.username,
      senderRole: user.role,
      title: pmTitle,
      chatType: 'private',
      receiverId,
      partnerId: user.id,
      targetUserIds: [receiverId],
      messageId: id,
      snippet: pmSnippet,
    }).catch(() => {});

    return res.json({ success: true, message: msgRecord });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إرسال الرسالة الخاصة' });
  }
});

apiRouter.post('/private-messages/:messageId/reaction', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const { emoji, conversationId } = req.body || {};
    if (!emoji) return res.status(400).json({ error: 'رمز التفاعل مطلوب' });

    const targetConv = conversationId || '';
    const reactions = await togglePrivateMessageReaction(targetConv, req.params.messageId, user.id, String(emoji));
    return res.json({ success: true, reactions });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إضافة التفاعل' });
  }
});

apiRouter.post('/private-messages/reaction', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const { emoji, messageId, conversationId } = req.body || {};
    if (!emoji || !messageId) return res.status(400).json({ error: 'معرف الرسالة ورمز التفاعل مطلوبان' });

    const targetConv = conversationId || '';
    const reactions = await togglePrivateMessageReaction(targetConv, messageId, user.id, String(emoji));
    return res.json({ success: true, reactions });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إضافة التفاعل' });
  }
});

apiRouter.post('/private-messages/:messageId/pin', async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.body || {};
    const isPinned = await togglePinPrivateMessage(conversationId || '', req.params.messageId);
    return res.json({ success: true, pinned: isPinned });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تثبيت الرسالة' });
  }
});

apiRouter.post('/private-messages/pin', async (req: Request, res: Response) => {
  try {
    const { messageId, conversationId } = req.body || {};
    if (!messageId) return res.status(400).json({ error: 'معرف الرسالة مطلوب' });

    const isPinned = await togglePinPrivateMessage(conversationId || '', messageId);
    return res.json({ success: true, pinned: isPinned });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تثبيت الرسالة' });
  }
});

// ============================================================================
// CHALLENGES & TRADES
// ============================================================================

apiRouter.get('/challenges/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const challenge = await getUserChallenge(userId);
    return res.json({ challenge, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب بيانات التحدي' });
  }
});

apiRouter.post('/challenges/:userId', async (req: Request, res: Response) => {
  try {
    const challenge = req.body.challenge || req.body;
    await saveUserChallenge(challenge);
    return res.json({ success: true, challenge });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل حفظ بيانات التحدي' });
  }
});

apiRouter.get('/trades/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const trades = await getUserTrades(userId);
    return res.json({ trades, success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب الصفقات' });
  }
});

apiRouter.post('/trades/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    const { trade, challenge } = req.body;
    await addTradeRecord(userId, trade, challenge);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تسجيل الصفقة' });
  }
});

// ============================================================================
// FILE UPLOAD ROUTES
// ============================================================================

const uploadsDir = path.resolve('data/uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

apiRouter.post('/files/upload', async (req: Request, res: Response) => {
  try {
    const { fileName, fileData, mimeType, folder } = req.body;
    if (!fileData) {
      return res.status(400).json({ error: 'بيانات الملف مطلوبة' });
    }

    let buffer: Buffer;
    if (fileData.includes(';base64,')) {
      const base64Data = fileData.split(';base64,')[1];
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      buffer = Buffer.from(fileData, 'base64');
    }

    const safeExt = path.extname(fileName || '') || (mimeType?.includes('png') ? '.png' : mimeType?.includes('jpeg') ? '.jpg' : '.bin');
    const randomSuffix = crypto.randomBytes(6).toString('hex');
    const savedName = `${Date.now()}_${randomSuffix}_${path.basename(fileName || 'file', safeExt)}${safeExt}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    
    const targetFolder = folder ? path.join(uploadsDir, folder) : uploadsDir;
    if (!fs.existsSync(targetFolder)) fs.mkdirSync(targetFolder, { recursive: true });

    const filePath = path.join(targetFolder, savedName);
    fs.writeFileSync(filePath, buffer);

    const relativeUrl = folder ? `/uploads/${folder}/${savedName}` : `/uploads/${savedName}`;
    return res.json({
      success: true,
      fileUrl: relativeUrl,
      fileName: savedName,
      size: buffer.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل رفع الملف' });
  }
});

apiRouter.get('/files/:filename', (req: Request, res: Response) => {
  const filePath = path.join(uploadsDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  return res.status(404).json({ error: 'الملف غير موجود' });
});

// ============================================================================
// FCM PUSH NOTIFICATIONS
// ============================================================================

apiRouter.get('/fcm/vapid-public-key', (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, publicKey: getWebPushPublicKey() });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب مفتاح الإشعارات' });
  }
});

apiRouter.post('/fcm/register', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const { token, deviceId, platform, deviceModel, subscription } = req.body || {};
    if (!token && !subscription?.endpoint) {
      return res.status(400).json({ error: 'رمز الجهاز أو اشتراك الإشعارات مطلوب' });
    }

    const record = await registerDeviceToken({
      token: token || subscription?.endpoint,
      userId: user.id,
      username: user.displayName || user.username,
      deviceId,
      platform: platform || (subscription ? 'web' : 'android'),
      deviceModel,
      subscription: subscription || null,
    });

    return res.json({ success: true, record });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تسجيل رمز الجهاز' });
  }
});

apiRouter.post('/fcm/unregister', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const { token, deviceId } = req.body || {};
    await unregisterDeviceToken(user.id, token, deviceId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إلغاء رمز الجهاز' });
  }
});

apiRouter.post('/fcm/dispatch', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    const {
      title,
      body,
      targetUserIds,
      receiverId,
      partnerId,
      channelId,
      chatType,
      messageId,
      senderName,
    } = req.body || {};

    const result = await dispatchAuthorizedChatPush({
      senderId: user.id,
      senderName: senderName || user.displayName || user.username,
      senderRole: user.role,
      title: title ? String(title) : undefined,
      chatType: chatType === 'private' ? 'private' : 'channel',
      channelId,
      receiverId,
      partnerId,
      targetUserIds: Array.isArray(targetUserIds) ? targetUserIds : undefined,
      messageId: messageId ? String(messageId) : `msg_${Date.now()}`,
      snippet: body || title || '',
    });

    return res.json({ ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل إرسال الإشعار' });
  }
});

// ============================================================================
// APP UPDATES ROUTES
// ============================================================================

apiRouter.get('/app-updates', async (_req: Request, res: Response) => {
  try {
    const update = await getLatestAppUpdate();
    return res.json(update);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل جلب التحديث' });
  }
});

apiRouter.get('/app-updates/admin-bootstrap', async (_req: Request, res: Response) => {
  try {
    const currentUpdate = await getLatestAppUpdate();
    const history = await getAppUpdatesHistory();
    const globalDistribution = getGlobalUpdateDistribution();
    const keyStatus = getOriginalSamiSigningKeyStatus();
    const ghSettings = await getSavedGitHubSettingsSummary();

    return res.json({
      currentUpdate,
      history,
      globalDistribution,
      keyStatus,
      storageBucket: `${projectId}.firebasestorage.app`,
      firebaseProjectId: projectId,
      firestoreDatabaseId: databaseId,
      githubSettings: ghSettings,
      success: true,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تهيئة لوحة التحديثات' });
  }
});

apiRouter.get('/app-updates/download/:version', async (req: Request, res: Response) => {
  try {
    const rawTarget = req.params.version;
    let update = await getAppUpdateByVersionOrId(rawTarget);
    if (!update && rawTarget === 'latest') {
      update = await getLatestAppUpdate();
    }
    if (!update) {
      update = await getLatestAppUpdate();
    }
    if (!update) {
      return res.status(404).json({ error: 'لا يوجد تحديث متاح' });
    }

    const uploadsDir = path.resolve('data/uploads');
    const localApkPath = path.resolve(uploadsDir, `sami_update_v${update.versionCode}.apk`);
    const fallbackFileName = update.fileName || `Salim-v${update.versionName}.apk`;

    // 1. If local APK file is on disk, stream it with full HTTP 206 Partial Content support
    if (fs.existsSync(localApkPath)) {
      const stat = fs.statSync(localApkPath);
      const totalSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

        if (start >= totalSize || end >= totalSize) {
          res.status(416).set('Content-Range', `bytes */${totalSize}`).end();
          return;
        }

        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(localApkPath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fallbackFileName)}"`,
        });
        stream.pipe(res);
        return;
      } else {
        res.writeHead(200, {
          'Content-Length': totalSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(fallbackFileName)}"`,
        });
        fs.createReadStream(localApkPath).pipe(res);
        return;
      }
    }

    // 2. If an external or Firebase Storage download URL exists, redirect to it
    if (update.downloadUrl && update.downloadUrl.startsWith('https://')) {
      return res.redirect(302, update.downloadUrl);
    }

    return res.status(404).json({ error: 'ملف الـ APK غير متوفر حالياً على الخادم' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تحميل ملف التحديث' });
  }
});

apiRouter.post('/app-updates/inspect-apk', async (req: Request, res: Response) => {
  try {
    const { apkBase64, fileName, publishedVersionCode } = req.body;
    let buffer: Buffer;
    if (apkBase64) {
      buffer = Buffer.from(apkBase64, 'base64');
    } else {
      buffer = Buffer.alloc(2048);
    }

    const inspected = await inspectApkBuffer({
      buffer,
      fileName,
      publishedVersionCode: Number(publishedVersionCode) || undefined,
    });
    return res.json({ success: true, data: inspected });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل فحص ملف APK' });
  }
});

// Resumable Chunked Upload for APKs: Handles slow connections and resume without restarts
apiRouter.post('/app-updates/upload-chunk', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    if (user.role !== 'owner' && user.role !== 'admin' && user.id !== 1) {
      return res.status(403).json({ error: 'صلاحيات غير كافية لرفع تحديثات التطبيق' });
    }

    // Support both header-based binary streams and JSON body
    const uploadId = req.headers['x-upload-id'] || req.body?.uploadId;
    const rawOffset = req.headers['x-offset'] ?? req.body?.offset;
    const rawTotal = req.headers['x-total-size'] ?? req.body?.totalBytes;
    const offset = typeof rawOffset === 'string' ? parseInt(rawOffset, 10) : Number(rawOffset);
    const totalBytes = typeof rawTotal === 'string' ? parseInt(rawTotal, 10) : Number(rawTotal);

    let chunkBuf: Buffer | null = null;
    if (Buffer.isBuffer(req.body)) {
      chunkBuf = req.body;
    } else if (req.body?.chunkBase64) {
      chunkBuf = Buffer.from(req.body.chunkBase64, 'base64');
    }

    if (!uploadId || isNaN(offset) || isNaN(totalBytes) || !chunkBuf || chunkBuf.length === 0) {
      return res.status(400).json({ error: 'بيانات شريحة الرفع غير مكتملة' });
    }

    const cleanUploadId = String(uploadId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const uploadsDir = path.resolve('data/uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const stagingPath = path.resolve(uploadsDir, `staging_${cleanUploadId}.part`);

    // Open and write chunk at designated offset
    const fd = fs.openSync(stagingPath, fs.existsSync(stagingPath) ? 'r+' : 'w');
    try {
      fs.writeSync(fd, chunkBuf, 0, chunkBuf.length, offset);
    } finally {
      fs.closeSync(fd);
    }

    const currentStat = fs.statSync(stagingPath);
    const receivedBytes = currentStat.size;
    const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));

    return res.json({
      success: true,
      uploadId: cleanUploadId,
      receivedBytes,
      uploadedBytes: receivedBytes,
      totalBytes,
      percent,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل حفظ شريحة الملف' });
  }
});

apiRouter.get('/app-updates/upload-status/:uploadId', (req: Request, res: Response) => {
  try {
    const cleanUploadId = String(req.params.uploadId).replace(/[^a-zA-Z0-9_\-]/g, '');
    const stagingPath = path.resolve('data/uploads', `staging_${cleanUploadId}.part`);

    if (fs.existsSync(stagingPath)) {
      const stat = fs.statSync(stagingPath);
      return res.json({ success: true, exists: true, receivedBytes: stat.size, uploadedBytes: stat.size });
    }
    return res.json({ success: true, exists: false, receivedBytes: 0, uploadedBytes: 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل الاستعلام عن حالة الرفع' });
  }
});

// Direct Publish endpoint for Firebase APK Updates
apiRouter.post('/app-updates/publish-firebase', async (req: Request, res: Response) => {
  try {
    const user = getEffectiveUser(req);
    if (user.role !== 'owner' && user.role !== 'admin' && user.id !== 1) {
      return res.status(403).json({ error: 'صلاحيات غير كافية لنشر تحديثات التطبيق' });
    }

    const {
      uploadId,
      fileName,
      description,
      isMandatory,
      versionCode: clientVerCode,
      versionName: clientVerName,
      sha256: clientSha,
      signingCertSha256: clientCertSha,
      storagePath: clientStoragePath,
      downloadUrl: clientDownloadUrl,
    } = req.body;

    const uploadsDir = path.resolve('data/uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    let finalApkBuffer: Buffer | null = null;
    let actualFileSize = 0;
    let computedSha = '';

    if (uploadId) {
      const cleanUploadId = String(uploadId).replace(/[^a-zA-Z0-9_\-]/g, '');
      const stagingPath = path.resolve(uploadsDir, `staging_${cleanUploadId}.part`);

      if (!fs.existsSync(stagingPath)) {
        return res.status(400).json({ error: 'لم يتم العثور على ملف التحديث المرفوع. يرجى إعادة إرفاق الملف.' });
      }

      finalApkBuffer = fs.readFileSync(stagingPath);
      actualFileSize = finalApkBuffer.length;
      computedSha = crypto.createHash('sha256').update(finalApkBuffer).digest('hex');
    }

    const currentLatest = await getLatestAppUpdate();
    const currentCode = currentLatest?.versionCode || 15;

    // Inspect APK buffer if uploaded through staging
    let vCode = clientVerCode ? Math.floor(Number(clientVerCode)) : currentCode + 1;
    let vName = clientVerName ? String(clientVerName).trim() : `1.4.${vCode - 15}`;
    let sha = (clientSha || computedSha).toLowerCase();
    let certSha = clientCertSha || 'A5:72:42:C8:38:22:CE:E1:94:DF:80:BC:87:C5:F0:7C:F4:4B:91:CA:52:99:93:37:A6:BA:5D:87:CD:71:BC:B6';

    if (finalApkBuffer) {
      const inspectRes = await inspectApkBuffer({
        buffer: finalApkBuffer,
        fileName: fileName || `Salim-v${vName}.apk`,
        publishedVersionCode: currentCode,
      });

      if (!inspectRes.valid && inspectRes.errors.length > 0) {
        return res.status(400).json({ error: inspectRes.errors.join(' | ') });
      }

      vCode = inspectRes.versionCode;
      vName = inspectRes.versionName;
      sha = inspectRes.sha256;
      if (inspectRes.signingCertificate?.sha256Fingerprint) {
        certSha = inspectRes.signingCertificate.sha256Fingerprint;
      }

      // Promote staging file to final cached APK file
      const finalApkPath = path.resolve(uploadsDir, `sami_update_v${vCode}.apk`);
      fs.writeFileSync(finalApkPath, finalApkBuffer);

      // Clean staging file
      try {
        const cleanUploadId = String(uploadId).replace(/[^a-zA-Z0-9_\-]/g, '');
        fs.unlinkSync(path.resolve(uploadsDir, `staging_${cleanUploadId}.part`));
      } catch {}
    }

    if (vCode <= currentCode) {
      return res.status(400).json({
        error: `رقم الإصدار الجديد (${vCode}) يجب أن يكون أكبر من الإصدار الحالي المنشور (${currentCode}) لكي يقبله نظام Android.`,
      });
    }

    const now = Date.now();
    const storagePath = clientStoragePath || `apk_releases/sami_v${vCode}_${sha.slice(0, 10)}.apk`;

    // Construct authoritative Firebase Storage Download URL
    // Format: https://firebasestorage.googleapis.com/v0/b/<storageBucket>/o/<storagePath>?alt=media
    const storageBucket = `${projectId}.firebasestorage.app`;
    const firebaseDownloadUrl =
      clientDownloadUrl ||
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;

    const secureDownloadPath = `/api/app-updates/download/v_${vCode}`;

    const updateRecord = {
      id: `v_${vCode}`,
      updateId: `fb_${now}_${vCode}`,
      versionCode: vCode,
      versionName: vName,
      title: `تحديث Salim v${vName}`,
      description: description ? String(description).trim() : 'تحديث جديد لتحسين الأداء وتجربة المستخدم.',
      downloadUrl: firebaseDownloadUrl,
      secureDownloadPath,
      storagePath,
      storageSource: 'firebase_storage' as const,
      deliveryMethod: 'firebase_storage' as const,
      fileSize: actualFileSize || (req.body.fileSize ? Math.floor(Number(req.body.fileSize)) : 28000000),
      fileName: fileName || `Salim-v${vName}.apk`,
      applicationId: 'com.sami.tradingchallengetracker',
      sha256: sha,
      signingCertSha256: certSha,
      isMandatory: Boolean(isMandatory),
      isActive: true,
      isHidden: false,
      distributionStatus: 'enabled' as const,
      isEligibleForDistribution: true,
      publishedBy: user.displayName || user.username || 'Salim',
      uploadedAt: now,
      publishedAt: now,
      updatedAt: now,
    };

    // Save and verify in Cloud Firestore (both 'latest' and versioned doc) and local store
    const verified = await saveAppUpdateRecord(updateRecord);

    // Send push notification to all users alerting them of the published update
    try {
      await sendNotificationToUsers([], {
        title: `🚀 تحديث جديد متوفر: Salim v${vName}`,
        body: updateRecord.description.slice(0, 150),
        chatType: 'channel',
        data: {
          type: 'app_update',
          versionCode: String(vCode),
          versionName: vName,
        },
      });
    } catch {}

    return res.json({
      success: true,
      message: `تم نشر الإصدار Salim v${vName} (كود ${vCode}) بنجاح إلى Firebase!`,
      update: verified,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل نشر التحديث إلى Firebase' });
  }
});

apiRouter.post('/app-updates/toggle', async (req: Request, res: Response) => {
  try {
    const { updateId, isHidden } = req.body;
    const updated = await toggleAppUpdateVisibility(updateId, isHidden);
    return res.json({ success: true, update: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تغيير حالة التحديث' });
  }
});

apiRouter.post('/app-updates/rollback', async (req: Request, res: Response) => {
  try {
    const { targetVersionCode } = req.body;
    const rolledBack = await rollbackAppUpdateToVersion(Number(targetVersionCode));
    return res.json({ success: true, update: rolledBack });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل التراجع عن التحديث' });
  }
});

apiRouter.post('/app-updates/global-distribution', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    await setGlobalUpdateDistribution(Boolean(enabled));
    return res.json({ success: true, enabled: Boolean(enabled) });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تغيير حالة التوزيع العام' });
  }
});

apiRouter.post('/app-updates/publish-external', async (req: Request, res: Response) => {
  try {
    const published = await publishExternalAppUpdate(req.body);
    return res.json({ success: true, update: published });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل نشر التحديث الخارجي' });
  }
});

apiRouter.post('/app-updates/toggle-individual', async (req: Request, res: Response) => {
  try {
    const { updateId, enabled } = req.body;
    const updated = await toggleIndividualUpdateDistribution(updateId, Boolean(enabled));
    return res.json({ success: true, update: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تغيير حالة التحديث الفردي' });
  }
});

apiRouter.post('/app-updates/edit-url', async (req: Request, res: Response) => {
  try {
    const { updateId, downloadUrl } = req.body;
    const updated = await updateAppUpdateDownloadUrl(updateId, downloadUrl);
    return res.json({ success: true, update: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'فشل تعديل رابط التحميل' });
  }
});
