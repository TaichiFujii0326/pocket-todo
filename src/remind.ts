import { queryDueTasks } from "./notion";
import { sendPushToAll, type PushEnv } from "./push";

type RemindEnv = PushEnv & {
  NOTION_TOKEN: string;
  NOTION_DATA_SOURCE_ID: string;
};

// 期限が今日/超過の未完了タスクを、登録済み端末へWeb Pushで通知する。
// 該当タスクが無い日は何も送らない(通知疲れ防止)。
export async function sendDailyReminder(env: RemindEnv): Promise<{ sent: boolean; count: number }> {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const tasks = await queryDueTasks(env.NOTION_TOKEN, env.NOTION_DATA_SOURCE_ID, today);
  if (tasks.length === 0) {
    return { sent: false, count: 0 };
  }

  const dueToday = tasks.filter((t) => t.due >= today);
  const overdue = tasks.filter((t) => t.due < today);
  const lines: string[] = [];
  if (dueToday.length > 0) {
    lines.push(`📌 今日が期限 (${dueToday.length}件)`);
    for (const t of dueToday) lines.push(`・${t.title}`);
  }
  if (overdue.length > 0) {
    lines.push(`🔥 期限超過 (${overdue.length}件)`);
    for (const t of overdue) lines.push(`・${t.title} (${t.due.slice(5).replace("-", "/")}〜)`);
  }

  const delivered = await sendPushToAll(env, "⏰ 今日のタスク", lines.join("\n"));
  return { sent: delivered > 0, count: tasks.length };
}
