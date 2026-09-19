import { Hono } from "hono";
import { fallbackFields, interpretInput, type Intent, type TaskFields } from "./classify";
import { iconPngBase64 } from "./icon";
import {
  createNotionTask,
  getTaskPage,
  queryOpenTasks,
  trashTask,
  updateTaskStatus,
  type OpenTask,
} from "./notion";
import { formPage } from "./page";
import { deleteAllSubscriptions, parseSubscription, saveSubscription, sendPushToAll } from "./push";
import { cleanupCompletedTasks, sendDailyReminder } from "./remind";

type Env = {
  AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  PUSH_SUBS: KVNamespace;
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
  return c.html(formPage.replace("__VAPID_PUBLIC_KEY__", c.env.VAPID_PUBLIC_KEY));
});

// Web Push用のService Worker。プッシュ受信時に通知を表示する
app.get("/sw.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  return c.body(`self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "pocket-todo", {
    body: data.body || "",
    icon: "/icon.png?v=2",
    badge: "/icon.png?v=2",
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});`);
});

app.get("/manifest.json", (c) =>
  c.json({
    name: "pocket-todo",
    short_name: "pocket-todo",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f4",
    theme_color: "#2563eb",
    icons: [{ src: "/icon.png?v=2", sizes: "512x512", type: "image/png" }],
  }),
);

app.get("/icon.png", (c) => {
  c.header("Content-Type", "image/png");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(Uint8Array.from(atob(iconPngBase64), (ch) => ch.charCodeAt(0)));
});

// 端末のプッシュ購読情報を登録する(フォームの「通知を有効にする」から呼ばれる)
app.post("/api/push/subscribe", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }
  const sub = parseSubscription(await c.req.json().catch(() => null));
  if (!sub) {
    return c.json({ error: "invalid subscription" }, 400);
  }
  if (!(await saveSubscription(c.env, sub))) {
    return c.json({ error: "subscription limit reached" }, 429);
  }
  return c.json({ ok: true });
});

// 全購読の破棄。トークンローテーション手順の一部(CLAUDE.md参照)
app.post("/api/push/reset", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }
  const removed = await deleteAllSubscriptions(c.env);
  return c.json({ removed });
});

// テスト通知(設定確認用)
app.post("/api/push/test", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }
  const { success } = await c.env.RATE_LIMITER.limit({ key: "remind" });
  if (!success) {
    return c.json({ error: "rate limited" }, 429);
  }
  const sent = await sendPushToAll(c.env, "🔔 テスト通知", "プッシュ通知の設定が完了しました🎉");
  return c.json({ sent });
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

const jstToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

// 今日ビュー: 期限超過 / 今日が期限 / 期限なし高優先 の未完了タスク
app.get("/api/today", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }
  try {
    const today = jstToday();
    const weekAhead = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    );
    const tasks = await queryOpenTasks(c.env.NOTION_TOKEN, c.env.NOTION_DATA_SOURCE_ID);
    return c.json({
      date: today,
      overdue: tasks.filter((t) => t.due && t.due < today).sort((a, b) => (a.due < b.due ? -1 : 1)),
      dueToday: tasks.filter((t) => t.due === today),
      // 優先度高は期限の有無にかかわらず常に見せる(上2セクションと重複するものは除く)
      highPriority: tasks
        .filter((t) => t.priority === "高" && !(t.due && t.due <= today))
        .sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1),
      // 近日: 明日〜7日以内が期限のタスク(優先度高セクションに出ているものは除く)
      upcoming: tasks
        .filter((t) => t.due && t.due > today && t.due <= weekAhead && t.priority !== "高")
        .sort((a, b) => (a.due < b.due ? -1 : 1)),
    });
  } catch (err) {
    console.error("today view failed:", err);
    return c.json({ error: "failed to load tasks" }, 502);
  }
});

// 今日ビューの完了タップ。AI呼び出しが無いのでレートリミット対象外
app.post("/api/complete", async (c) => {
  const authError = checkAuth(c);
  if (authError) {
    return c.json({ error: authError === 503 ? "server not configured" : "unauthorized" }, authError as 401 | 503);
  }
  const body = await c.req.json<{ id?: unknown }>().catch(() => null);
  if (typeof body?.id !== "string" || !/^[0-9a-f-]{32,36}$/.test(body.id)) {
    return c.json({ error: "invalid task id" }, 400);
  }
  try {
    // タスクDB外のページを操作しない(所属データソースの確認)
    const page = await getTaskPage(c.env.NOTION_TOKEN, body.id);
    if (!page || page.dataSourceId !== c.env.NOTION_DATA_SOURCE_ID) {
      return c.json({ error: "task not found" }, 404);
    }
    await updateTaskStatus(c.env.NOTION_TOKEN, body.id, "完了");
    // 完了通知は応答を待たせず裏で送る(タップの体感を守る)
    c.executionCtx.waitUntil(
      notify(c.env, "✅ 完了", `「${page.title}」を完了にしました`).catch((err) => {
        console.error("complete notify failed:", err);
      }),
    );
    return c.json({ ok: true });
  } catch (err) {
    console.error("complete failed:", err);
    return c.json({ error: "failed to complete task" }, 502);
  }
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

async function createWithRetry(env: Env, fields: TaskFields): Promise<void> {
  try {
    await createNotionTask(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, fields);
  } catch (err) {
    console.error("notion write failed, retrying once:", err);
    await createNotionTask(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, fields);
  }
}

// 処理結果を登録済み端末へ知らせる(202即返し設計のフィードバックチャネル)
async function notify(env: Env, title: string, body: string): Promise<void> {
  await sendPushToAll(env, title, body);
}

// 入力の意図(新規/完了/遷移/削除)を判定して実行する。
// 判定に失敗しても、タイトルだけのタスクとして必ずNotionに残す。
// 「放り込んだのに消えた」だけは絶対に起こさない。
async function processTask(env: Env, text: string): Promise<void> {
  let intent: Intent;
  let openTasks: OpenTask[] = [];
  try {
    openTasks = await queryOpenTasks(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID);
    intent = await interpretInput(env.ANTHROPIC_API_KEY, text, openTasks);
  } catch (err) {
    console.error("interpret failed, falling back to title-only create:", err);
    await createWithRetry(env, fallbackFields(text));
    return;
  }

  try {
    switch (intent.action) {
      case "create": {
        const fields = intent.task ?? fallbackFields(text);
        // 期限の言及がないタスクはデフォルトで1週間後を期限にする(放置での埋もれ防止)
        if (!fields.due) {
          fields.due = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          );
        }
        await createWithRetry(env, fields);
        break;
      }
      case "complete":
      case "set_status": {
        const target = intent.target_index != null ? openTasks[intent.target_index] : undefined;
        if (!target) {
          await notify(env, "❓ pocket-todo", `対象タスクを特定できませんでした:「${text}」`);
          return;
        }
        const status = intent.action === "complete" ? "完了" : (intent.new_status ?? "進行中");
        await updateTaskStatus(env.NOTION_TOKEN, target.id, status);
        await notify(env, status === "完了" ? "✅ 完了" : `▶️ ${status}`, `「${target.title}」を${status}にしました`);
        break;
      }
      case "delete": {
        const target = intent.target_index != null ? openTasks[intent.target_index] : undefined;
        if (!target) {
          await notify(env, "❓ pocket-todo", `対象タスクを特定できませんでした:「${text}」`);
          return;
        }
        await trashTask(env.NOTION_TOKEN, target.id);
        await notify(env, "🗑️ 削除", `「${target.title}」をゴミ箱に移動しました(30日以内はNotionから復元できます)`);
        break;
      }
      case "unclear":
        await notify(env, "❓ pocket-todo", intent.note || `解釈できませんでした:「${text}」`);
        break;
    }
  } catch (err) {
    console.error("task operation failed:", err);
    await notify(env, "⚠️ pocket-todo", `処理に失敗しました:「${text}」`).catch(() => {});
  }
}

export default {
  fetch: app.fetch,
  // 毎朝8時(JST) = 23:00 UTC に発火(wrangler.jsoncのtriggers参照)
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      (async () => {
        await sendDailyReminder(env).catch((err) => {
          console.error("daily reminder failed:", err);
        });
        // リマインドとは独立に、完了から数日経ったタスクを掃除する
        await cleanupCompletedTasks(env).catch((err) => {
          console.error("cleanup failed:", err);
        });
      })(),
    );
  },
};
