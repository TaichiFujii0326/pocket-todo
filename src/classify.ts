import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const TaskFieldsSchema = z.object({
  title: z
    .string()
    .describe("タスク名。入力文から期限・優先度の表現を除いた簡潔な体言止め"),
  priority: z.enum(["高", "中", "低"]).nullable().describe("優先度。判断できなければnull"),
  tags: z.array(z.enum(["仕事", "個人", "開発"])).describe("当てはまるタグ。なければ空配列"),
  due: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe("期限。YYYY-MM-DD形式。期限の言及がなければnull"),
});

export type TaskFields = z.infer<typeof TaskFieldsSchema>;

export function fallbackFields(text: string): TaskFields {
  return { title: text, priority: null, tags: [], due: null };
}

// 入力文の意図判定。新規作成だけでなく、既存タスクの完了・遷移・削除も拾う
export const IntentSchema = z.object({
  action: z
    .enum(["create", "complete", "set_status", "delete", "unclear"])
    .describe(
      "create=新しいタスクの追加, complete=既存タスクを完了に, set_status=既存タスクのステータス変更, delete=既存タスクの削除, unclear=既存タスクへの操作に見えるが対象を特定できない",
    ),
  task: TaskFieldsSchema.nullable().describe("actionがcreateのときのタスク内容。それ以外はnull"),
  target_index: z
    .number()
    .int()
    .nullable()
    .describe("complete/set_status/deleteの対象。タスク一覧の番号。createとunclearではnull"),
  new_status: z
    .enum(["未着手", "進行中", "完了"])
    .nullable()
    .describe("set_statusのときの遷移先。それ以外はnull"),
  note: z.string().describe("unclearの理由などユーザー向けの短い一言。不要なら空文字"),
});

export type Intent = z.infer<typeof IntentSchema>;

export async function interpretInput(
  apiKey: string,
  text: string,
  openTasks: Array<{ title: string; status: string }>,
): Promise<Intent> {
  // タイムアウト/再試行はSDK既定(10分/2回)だとWorkersのwaitUntil約30秒に収まらず
  // タスクごと消えるため短く設定し、時間内にフォールバック登録へ落とす(M-06対策)
  const client = new Anthropic({ apiKey, timeout: 10_000, maxRetries: 1 });
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const taskList =
    openTasks.length > 0
      ? openTasks.map((t, i) => `${i}: [${t.status}] ${t.title}`).join("\n")
      : "(未完了タスクなし)";

  const response = await client.messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 2000,
    output_config: { format: zodOutputFormat(IntentSchema) },
    system: [
      "あなたはタスク管理アプリの意図判定エンジンです。ユーザーの1行入力を解析し、実行すべき操作を決めてください。",
      `今日は ${today} (日本時間) です。相対的な期限表現はこの日付を基準に解釈してください。`,
      "",
      "現在の未完了タスク一覧:",
      taskList,
      "",
      "判定ルール:",
      "- 新しいやることを書いた文 → create。タスク名・優先度(高/中/低)・タグ(仕事/個人/開発)・期限を推定する。根拠がない項目はnull/空",
      "- 「〜終わった」「〜完了」「〜done」など → complete。一覧から対象の番号を選ぶ",
      "- 「〜やり始めた」「〜着手」など → set_status(進行中)。「〜やっぱり戻す」→ set_status(未着手)",
      "- 「〜消して」「〜削除」「〜いらない」など → delete。一覧から対象の番号を選ぶ",
      "- 既存タスクへの操作に見えるのに、一覧に対象が見つからない・複数あって絞れない → unclear(理由をnoteに)。推測で操作してはいけない",
      "- 普通の名詞句や新しい用事はcreateに倒す",
    ].join("\n"),
    messages: [{ role: "user", content: text }],
  });

  if (!response.parsed_output) {
    throw new Error("intent interpretation returned no parsed output");
  }
  return response.parsed_output;
}

