import { queryDueTasks, queryStaleCompleted, trashTask } from "./notion";
import { sendPushToAll, type PushEnv } from "./push";

type RemindEnv = PushEnv & {
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
};

// 完了からこの日数が過ぎたタスクを毎朝ゴミ箱へ移す(Notion側で30日は復元可能)
const CLEANUP_AFTER_DAYS = 3;

export async function cleanupCompletedTasks(env: RemindEnv): Promise<number> {
  const cutoff = new Date(Date.now() - CLEANUP_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const stale = await queryStaleCompleted(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, cutoff);
  for (const task of stale) {
    await trashTask(env.NOTION_TOKEN, task.id);
  }
  if (stale.length > 0) {
    console.log(`cleaned up ${stale.length} completed tasks`);
  }
  return stale.length;
}

// 期限が今日/超過の未完了タスクを、登録済み端末へWeb Pushで通知する。
// 該当タスクが無い日は何も送らない(通知疲れ防止)。
export async function sendDailyReminder(env: RemindEnv): Promise<{ sent: boolean; count: number }> {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const tasks = await queryDueTasks(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, today);
  if (tasks.length === 0) {
    return { sent: false, count: 0 };
  }

  // Web Pushのペイロードは約4KBが上限(RFC 8291)。タイトルを丸め、
  // 各セクション先頭5件+残り件数に縮約して、件数が多い日でも配信が失敗しないようにする
  const MAX_PER_SECTION = 5;
  const clip = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
  const dueToday = tasks.filter((t) => t.due >= today);
  const overdue = tasks.filter((t) => t.due < today);
  const lines: string[] = [];
  if (dueToday.length > 0) {
    lines.push(`📌 今日が期限 (${dueToday.length}件)`);
    for (const t of dueToday.slice(0, MAX_PER_SECTION)) lines.push(`・${clip(t.title)}`);
    if (dueToday.length > MAX_PER_SECTION) lines.push(`…他${dueToday.length - MAX_PER_SECTION}件`);
  }
  if (overdue.length > 0) {
    lines.push(`🔥 期限超過 (${overdue.length}件)`);
    for (const t of overdue.slice(0, MAX_PER_SECTION)) {
      lines.push(`・${clip(t.title)} (${t.due.slice(5).replace("-", "/")}〜)`);
    }
    if (overdue.length > MAX_PER_SECTION) lines.push(`…他${overdue.length - MAX_PER_SECTION}件`);
  }

  const delivered = await sendPushToAll(env, "⏰ 今日のタスク", lines.join("\n"));
  return { sent: delivered > 0, count: tasks.length };
}
