import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { IUser, User } from '../models/User';
import { PasswordResetRequest } from '../models/PasswordResetRequest';
import { sendPushToUser } from './push';

const DEVICE_ID_RE = /^[a-zA-Z0-9._:-]{8,128}$/;

export function normalizeDeviceId(raw?: string | null): string | null {
  const id = String(raw || '').trim();
  if (!DEVICE_ID_RE.test(id)) return null;
  return id;
}

export function normalizePlatform(raw?: string | null): string {
  const p = String(raw || '').trim().toLowerCase().slice(0, 40);
  return p || 'unknown';
}

/** Upsert device + optionally mark as last login. */
export function touchUserDevice(
  user: IUser,
  deviceId: string,
  platform: string,
  asLogin: boolean,
) {
  const now = new Date();
  if (!Array.isArray(user.devices)) user.devices = [];
  const existing = user.devices.find(d => d.deviceId === deviceId);
  if (existing) {
    existing.lastSeenAt = now;
    if (platform && platform !== 'unknown') existing.platform = platform;
  } else {
    user.devices.push({
      deviceId,
      platform: platform || 'unknown',
      firstSeenAt: now,
      lastSeenAt: now,
    });
  }
  if (user.devices.length > 20) {
    user.devices.sort((a, b) => +new Date(b.lastSeenAt) - +new Date(a.lastSeenAt));
    user.devices = user.devices.slice(0, 20);
  }
  if (asLogin) {
    user.lastLoginAt = now;
    user.lastLoginDeviceId = deviceId;
    user.lastActiveAt = now;
  }
}

export function isKnownDevice(user: IUser, deviceId: string): boolean {
  if (user.lastLoginDeviceId && user.lastLoginDeviceId === deviceId) return true;
  return (user.devices || []).some(d => d.deviceId === deviceId);
}

export function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(10);
  for (let i = 0; i < 10; i++) out += chars[bytes[i]! % chars.length];
  return out;
}

export async function hashSecret(value: string): Promise<string> {
  return bcrypt.hash(value, 10);
}

export async function compareSecret(value: string, hash: string): Promise<boolean> {
  return bcrypt.compare(value, hash);
}

export function resetRequestCode(id: string): string {
  return `PWR-${String(id).slice(-6).toUpperCase()}`;
}

export function serializeResetForClient(doc: InstanceType<typeof PasswordResetRequest>) {
  return {
    id: doc.id,
    code: resetRequestCode(doc.id),
    email: doc.email,
    sameDevice: doc.sameDevice,
    status: doc.status,
    platform: doc.platform,
    messages: (doc.messages || []).map(m => ({
      role: m.role,
      message: m.message,
      createdAt: m.createdAt,
    })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    verifiedAt: doc.verifiedAt,
    tempPasswordSentAt: doc.tempPasswordSentAt,
  };
}

export async function issueTempPasswordForRequest(
  request: InstanceType<typeof PasswordResetRequest>,
) {
  const temp = generateTempPassword();
  const passwordHash = await hashSecret(temp);
  const userId =
    request.user && typeof request.user === 'object' && '_id' in (request.user as object)
      ? (request.user as { _id: unknown })._id
      : request.user;

  await User.updateOne(
    { _id: userId },
    { $set: { passwordHash, mustChangePassword: true } },
  );

  const msg =
    `Your temporary password is:\n\n${temp}\n\n` +
    `Log in with this password, then set a new one when prompted.`;
  request.messages.push({ role: 'admin', message: msg, createdAt: new Date() });
  request.status = 'temp_password_sent';
  request.tempPasswordSentAt = new Date();
  await request.save();

  try {
    await sendPushToUser(String(userId), {
      title: 'Password reset ready',
      body: 'Open Expenso → Forgot password to see your temporary password.',
      data: { type: 'password_reset', requestId: String(request._id) },
    });
  } catch {
    /* ignore */
  }

  return temp;
}
