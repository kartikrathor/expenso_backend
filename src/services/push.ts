import fs from 'fs';
import path from 'path';
import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { User } from '../models/User';

let app: App | null = null;

function initFirebase(): boolean {
  if (app) return true;
  if (getApps().length) {
    app = getApps()[0]!;
    return true;
  }

  try {
    const jsonInline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();

    let serviceAccount: Record<string, unknown> | null = null;

    if (jsonInline) {
      serviceAccount = JSON.parse(jsonInline) as Record<string, unknown>;
    } else if (filePath) {
      const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
      if (!fs.existsSync(abs)) {
        console.warn(`⚠️  FIREBASE_SERVICE_ACCOUNT_PATH not found: ${abs}`);
        return false;
      }
      serviceAccount = JSON.parse(fs.readFileSync(abs, 'utf8')) as Record<string, unknown>;
    } else {
      return false;
    }

    app = initializeApp({
      credential: cert(serviceAccount as any),
    });
    console.log('🔔 Firebase Admin ready (FCM push enabled)');
    return true;
  } catch (err) {
    console.error('Firebase Admin init failed:', err);
    return false;
  }
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

async function pruneTokens(userId: string, bad: string[]) {
  if (!bad.length) return;
  await User.updateOne({ _id: userId }, { $pull: { fcmTokens: { $in: bad } } });
}

export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!initFirebase() || !app) return 0;

  const user = await User.findById(userId).select('fcmTokens');
  const tokens = (user?.fcmTokens || []).filter(Boolean);
  if (!tokens.length) return 0;

  const messaging = getMessaging(app);
  const bad: string[] = [];
  let sent = 0;

  for (const token of tokens) {
    try {
      await messaging.send({
        token,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data || {},
        android: {
          priority: 'high',
          notification: {
            channelId: 'expenso_default',
            sound: 'default',
          },
        },
      });
      sent += 1;
    } catch (err: any) {
      const code = String(err?.code || err?.errorInfo?.code || '');
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token') ||
        code.includes('invalid-argument')
      ) {
        bad.push(token);
      } else {
        console.warn('FCM send failed:', code || err?.message || err);
      }
    }
  }

  if (bad.length) await pruneTokens(userId, bad);
  return sent;
}

/** Send the same push to many users. */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<{ usersNotified: number; devicesSent: number }> {
  const unique = [...new Set(userIds.map(String).filter(Boolean))];
  let usersNotified = 0;
  let devicesSent = 0;
  for (const id of unique) {
    const n = await sendPushToUser(id, payload);
    if (n > 0) {
      usersNotified += 1;
      devicesSent += n;
    }
  }
  return { usersNotified, devicesSent };
}

export function isPushConfigured(): boolean {
  return initFirebase();
}
