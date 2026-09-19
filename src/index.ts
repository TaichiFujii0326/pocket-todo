import { Hono } from "hono";
import { classifyTask, fallbackFields, type TaskFields } from "./classify";
import { createNotionTask } from "./notion";
import { formPage } from "./page";
import { sendDailyReminder } from "./remind";

type Env = {
  AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
  NTFY_TOPIC: string;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

const app = new Hono<{ Bindings: Env }>();

// H-01対策: シークレット未設定の環境では認証を通さず必ず拒否する(fail-closed)。
// 未設定だと期待値が "Bearer undefined" になり既知文字列で通過できてしまうため
function checkAuth(c: { env: Env; req: { header(name: string): string | undefined } }): number | null {
  if (!c.env.AUTH_TOKEN) return 503;
  if (c.req.header("Authorization") !== `Bearer ${c.env.AUTH_TOKEN}`) return 401;
  return null;
}

app.get("/", (c) => {
  // L-01対策: クリックジャッキング防止(iframe埋め込み禁止)とMIMEスニッフィング防止
  c.header("Content-Security-Policy", "frame-ancestors 'none'");
  c.header("X-Content-Type-Options", "nosniff");
  return c.html(formPage);
});

// タスク登録。応答は即返し、AI分類とNotion書き込みはwaitUntilでバックグラウンド実行する。
// 「2秒で放り込む」体感を守るための設計。
app.post("/api/tasks", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }

  // M-03対策: 型と長さを検証してから使う(非文字列は.trim()で500になっていた)
  const body = await c.req.json<{ text?: unknown }>().catch(() => null);
  if (typeof body?.text !== "string") {
    return c.json({ error: "text must be a string" }, 400);
  }
  const text = body.text.trim();
  if (!text) {
    return c.json({ error: "text is required" }, 400);
  }
  if (text.length > 500) {
    return c.json({ error: "text is too long (max 500 chars)" }, 400);
  }

  // トークン漏洩時の課金悪用対策: Claude API呼び出しに到達するリクエストを毎分5件に制限。
  // 認証・バリデーション通過後に置くことで、正規の利用枠を無効リクエストに食われない
  const { success } = await c.env.RATE_LIMITER.limit({ key: "global" });
  if (!success) {
    return c.json({ error: "rate limited" }, 429);
  }

  c.executionCtx.waitUntil(processTask(c.env, text));
  return c.json({ ok: true }, 202);
});

// リマインドの手動実行(動作確認用)。cronと同じ処理を認証つきで叩ける
app.post("/api/remind", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }
  // M-01対策: 手動リマインドにも制限をかける(タスク登録とは別のカウント枠)
  const { success } = await c.env.RATE_LIMITER.limit({ key: "remind" });
  if (!success) {
    return c.json({ error: "rate limited" }, 429);
  }
  try {
    const result = await sendDailyReminder(c.env);
    return c.json(result);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

async function processTask(env: Env, text: string): Promise<void> {
  // 分類に失敗しても、タイトルだけのタスクとして必ずNotionに残す。
  // 「放り込んだのに消えた」だけは絶対に起こさない。
  let fields: TaskFields;
  try {
    fields = await classifyTask(env.ANTHROPIC_API_KEY, text);
  } catch (err) {
    console.error("classify failed, falling back to title-only:", err);
    fields = fallbackFields(text);
  }

  try {
    await createNotionTask(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, fields);
  } catch (err) {
    console.error("notion write failed, retrying once:", err);
    await createNotionTask(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, fields);
  }
}

export default {
  fetch: app.fetch,
  // 毎朝8時(JST) = 23:00 UTC に発火(wrangler.jsoncのtriggers参照)
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      sendDailyReminder(env).catch((err) => {
        console.error("daily reminder failed:", err);
      }),
    );
  },
};
