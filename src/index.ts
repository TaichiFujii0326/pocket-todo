import { Hono } from "hono";
import { classifyTask, fallbackFields, type TaskFields } from "./classify";
import { createNotionTask } from "./notion";
import { formPage } from "./page";

type Env = {
  AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
  RATE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
};

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(formPage));

// タスク登録。応答は即返し、AI分類とNotion書き込みはwaitUntilでバックグラウンド実行する。
// 「2秒で放り込む」体感を守るための設計。
app.post("/api/tasks", async (c) => {
  if (c.req.header("Authorization") !== `Bearer ${c.env.AUTH_TOKEN}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json<{ text?: string }>().catch(() => null);
  const text = body?.text?.trim();
  if (!text) {
    return c.json({ error: "text is required" }, 400);
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

export default app;
