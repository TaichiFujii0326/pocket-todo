import type { TaskFields } from "./classify";

const NOTION_API = "https://api.notion.com/v1/pages";
// data_source_id を parent に指定できるAPIバージョン
const NOTION_VERSION = "2025-09-03";

export async function createNotionTask(
  token: string,
  dataSourceId: string,
  fields: TaskFields,
): Promise<void> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: fields.title } }] },
    ステータス: { status: { name: "未着手" } },
  };
  if (fields.priority) {
    properties["優先度"] = { select: { name: fields.priority } };
  }
  if (fields.due) {
    properties["期限"] = { date: { start: fields.due } };
  }
  if (fields.tags.length > 0) {
    properties["タグ"] = { multi_select: fields.tags.map((name) => ({ name })) };
  }

  const res = await fetch(NOTION_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties,
    }),
  });

  if (!res.ok) {
    throw new Error(`Notion API error ${res.status}: ${await res.text()}`);
  }
}
