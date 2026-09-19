import type { TaskFields } from "./classify";

const NOTION_API = "https://api.notion.com/v1/pages";
// data_source_id を parent に指定できるAPIバージョン
const NOTION_VERSION = "2025-09-03";

export type DueTask = { title: string; due: string };

// 期限が指定日以前で、未完了のタスクを期限昇順で返す(リマインド用)
export async function queryDueTasks(
  token: string,
  dataSourceId: string,
  todayISO: string,
): Promise<DueTask[]> {
  const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: {
        and: [
          { property: "期限", date: { on_or_before: todayISO } },
          { property: "ステータス", status: { does_not_equal: "完了" } },
        ],
      },
      sorts: [{ property: "期限", direction: "ascending" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion query error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    results: Array<{
      properties: {
        Name?: { title?: Array<{ plain_text: string }> };
        期限?: { date?: { start: string } | null };
      };
    }>;
  };
  return data.results.map((page) => ({
    title: page.properties.Name?.title?.map((t) => t.plain_text).join("") || "(無題)",
    due: page.properties.期限?.date?.start ?? "",
  }));
}

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
