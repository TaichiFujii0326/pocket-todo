import webpush, { type PushSubscription } from "web-push";

export type PushEnv = {
  PUSH_SUBS: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

// 主要ブラウザの正規Pushサービスのみ許可。任意のHTTPS宛先を登録されると、
// 通知のたびにWorkerがそこへ暗号文をPOSTする転送装置にされ得るため
const PUSH_HOST_ALLOWLIST = [
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /(^|\.)notify\.windows\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
];

// 購読情報を検証する(ブラウザのPushSubscription.toJSON()の形)。
// 宛先ホストの許可リストと鍵の形式(base64url・妥当な長さ)まで確認する
export function parseSubscription(body: unknown): PushSubscription | null {
  const sub = body as PushSubscription | null;
  if (typeof sub?.endpoint !== "string" || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") {
    return null;
  }
  if (!PUSH_HOST_ALLOWLIST.some((re) => re.test(url.hostname))) {
    return null;
  }
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(sub.keys.p256dh) || !/^[A-Za-z0-9_-]{16,64}$/.test(sub.keys.auth)) {
    return null;
  }
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

async function subscriptionKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 個人用途で端末数は数台のはず。無制限に溜まるのを防ぐ(false=上限で拒否)
const MAX_SUBSCRIPTIONS = 10;

export async function saveSubscription(env: PushEnv, sub: PushSubscription): Promise<boolean> {
  const key = await subscriptionKey(sub.endpoint);
  const existing = await env.PUSH_SUBS.get(key);
  if (!existing) {
    const list = await env.PUSH_SUBS.list();
    if (list.keys.length >= MAX_SUBSCRIPTIONS) return false;
  }
  await env.PUSH_SUBS.put(key, JSON.stringify(sub));
  return true;
}

// トークンローテーション時などに全購読を破棄する(各端末で再有効化が必要になる)
export async function deleteAllSubscriptions(env: PushEnv): Promise<number> {
  const list = await env.PUSH_SUBS.list();
  for (const key of list.keys) {
    await env.PUSH_SUBS.delete(key.name);
  }
  return list.keys.length;
}

// 登録済みの全端末へプッシュ送信。失効した購読(404/410)は掃除する
export async function sendPushToAll(env: PushEnv, title: string, body: string): Promise<number> {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const list = await env.PUSH_SUBS.list();
  let sent = 0;
  for (const key of list.keys) {
    const raw = await env.PUSH_SUBS.get(key.name);
    if (!raw) continue;
    try {
      await webpush.sendNotification(JSON.parse(raw) as PushSubscription, JSON.stringify({ title, body }), {
        TTL: 3600,
        timeout: 5000, // 遅い宛先1件が全端末への配信を止めないように
      });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await env.PUSH_SUBS.delete(key.name);
      } else {
        console.error("push send failed:", status, err);
      }
    }
  }
  return sent;
}
