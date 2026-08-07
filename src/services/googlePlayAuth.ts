import fs from 'fs';
import path from 'path';
import { google, androidpublisher_v3 } from 'googleapis';

export function getPlayPackageName() {
  return process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.kriovent.expenso';
}

function parseServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (raw?.trim()) {
    try {
      return JSON.parse(raw);
    } catch {
      console.warn('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON');
      return null;
    }
  }

  const configuredPath = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  const candidates = [
    configuredPath ? path.resolve(configuredPath) : null,
    path.join(process.cwd(), 'secrets', 'google-play-service-account.json'),
    path.join(process.cwd(), 'secerets', 'google-play-service-account.json'),
  ].filter(Boolean) as string[];

  for (const credentialsPath of candidates) {
    if (!fs.existsSync(credentialsPath)) continue;
    try {
      return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    } catch {
      console.warn('Google Play service-account file is missing or invalid');
    }
  }
  return null;
}

export async function getAndroidPublisher(): Promise<androidpublisher_v3.Androidpublisher | null> {
  const credentials = parseServiceAccount();
  if (!credentials) return null;
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  return google.androidpublisher({ version: 'v3', auth });
}
