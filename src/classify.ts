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

// 1行の自由文からNotionプロパティを推定する。「明日まで」「急ぎ」などの
// 相対表現を解釈させるため、今日の日付(JST)をプロンプトに埋め込む。
export async function classifyTask(apiKey: string, text: string): Promise<TaskFields> {
  const client = new Anthropic({ apiKey });
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 2000,
    output_config: { effort: "low", format: zodOutputFormat(TaskFieldsSchema) },
    system: [
      "あなたはタスク管理アプリの分類エンジンです。",
      "ユーザーが1行で書いたタスクを解析し、タスク名・優先度・タグ・期限を抽出してください。",
      `今日は ${today} (日本時間) です。「明日」「来週金曜」などの相対的な期限はこの日付を基準に解釈してください。`,
      "優先度は「急ぎ」「!」「until系の近い期限」などの手がかりから推定し、根拠がなければnullにしてください。",
      "タグは内容から推定してください: 仕事(業務・会議・資料など) / 個人(買い物・家事・私用など) / 開発(コーディング・技術学習など)。",
    ].join("\n"),
    messages: [{ role: "user", content: text }],
  });

  if (!response.parsed_output) {
    throw new Error("classification returned no parsed output");
  }
  return response.parsed_output;
}
