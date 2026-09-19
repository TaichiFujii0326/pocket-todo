import webpush, { type PushSubscription } from "web-push";

export type PushEnv = {
  PUSH_SUBS: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
};

// 購読情報の形を最低限検証する(ブラウザのPushSubscription.toJSON()の形)
export function parseSubscription(body: unknown): PushSubscription | null {
  const sub = body as PushSubscription | null;
  if (
    typeof sub?.endpoint !== "string" ||
    !sub.endpoint.startsWith("https://") ||
    typeof sub.keys?.p256dh !== "string" ||
    typeof sub.keys?.auth !== "string"
  ) {
    return null;
  }
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

async function subscriptionKey(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveSubscription(env: PushEnv, sub: PushSubscription): Promise<void> {
  await env.PUSH_SUBS.put(await subscriptionKey(sub.endpoint), JSON.stringify(sub));
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
      await webpush.sendNotification(JSON.parse(raw) as PushSubscription, JSON.stringify({ title, body }));
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
