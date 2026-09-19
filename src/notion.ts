import type { TaskFields } from "./classify";

const NOTION_API = "https://api.notion.com/v1/pages";
// data_source_id を parent に指定できるAPIバージョン
const NOTION_VERSION = "2025-09-03";

export type DueTask = { title: string; due: string };

// Notionの期限は日時(2026-09-19T10:00:00+09:00等)のこともある。
// 「今日」との比較はJSTの暦日に正規化してから行う(時刻つき期限が一覧から消えるバグの対策)
export function normalizeDueToJstDate(start: string): string {
  if (!start.includes("T")) return start;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(start));
}
export type OpenTask = { id: string; title: string; status: string; due: string; priority: string | null };

// 未完了(完了以外)のタスク一覧。意図判定で「どのタスクへの操作か」を選ばせるのに使う。
// has_moreをカーソルで辿る(上限300件: 今日ビューの表示漏れとAIの対象選択漏れの対策)
export async function queryOpenTasks(token: string, dataSourceId: string): Promise<OpenTask[]> {
  type QueryPage = {
    has_more: boolean;
    next_cursor: string | null;
    results: Array<{
      id: string;
      properties: {
        Name?: { title?: Array<{ plain_text: string }> };
        ステータス?: { status?: { name: string } | null };
        期限?: { date?: { start: string } | null };
        優先度?: { select?: { name: string } | null };
      };
    }>;
  };

  const tasks: OpenTask[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page++) {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { property: "ステータス", status: { does_not_equal: "完了" } },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Notion query error ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as QueryPage;
    for (const p of data.results) {
      tasks.push({
        id: p.id,
        title: p.properties.Name?.title?.map((t) => t.plain_text).join("") || "(無題)",
        status: p.properties.ステータス?.status?.name ?? "未着手",
        due: p.properties.期限?.date?.start ? normalizeDueToJstDate(p.properties.期限.date.start) : "",
        priority: p.properties.優先度?.select?.name ?? null,
      });
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return tasks;
}

// 完了済みかつ最終編集が指定日時以前のタスク(自動掃除の対象)。
// Notionは「完了にした日時」を持たないため、最終編集日時を近似として使う
export async function queryStaleCompleted(
  token: string,
  dataSourceId: string,
  beforeISO: string,
): Promise<Array<{ id: string; title: string }>> {
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
          { property: "ステータス", status: { equals: "完了" } },
          { timestamp: "last_edited_time", last_edited_time: { on_or_before: beforeISO } },
        ],
      },
      page_size: 100,
    }),
  });
  if (!res.ok) {
    throw new Error(`Notion query error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    results: Array<{ id: string; properties: { Name?: { title?: Array<{ plain_text: string }> } } }>;
  };
  return data.results.map((page) => ({
    id: page.id,
    title: page.properties.Name?.title?.map((t) => t.plain_text).join("") || "(無題)",
  }));
}

// ページの親データソースIDとタイトル。存在しない/アクセス不可ならnull。
// /api/completeの所属確認(データソース外のページを操作しない)と完了通知の文言に使う
export async function getTaskPage(
  token: string,
  pageId: string,
): Promise<{ dataSourceId: string | null; title: string } | null> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION },
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) {
    throw new Error(`Notion page fetch error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    parent?: { data_source_id?: string };
    properties?: { Name?: { title?: Array<{ plain_text: string }> } };
  };
  return {
    dataSourceId: data.parent?.data_source_id ?? null,
    title: data.properties?.Name?.title?.map((t) => t.plain_text).join("") || "(無題)",
  };
}

export async function updateTaskStatus(token: string, pageId: string, status: string): Promise<void> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: { ステータス: { status: { name: status } } } }),
  });
  if (!res.ok) {
    throw new Error(`Notion status update error ${res.status}: ${await res.text()}`);
  }
}

// Notionのゴミ箱へ移動(30日以内はNotion UIから復元できる)
export async function trashTask(token: string, pageId: string): Promise<void> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ in_trash: true }),
  });
  if (!res.ok) {
    throw new Error(`Notion trash error ${res.status}: ${await res.text()}`);
  }
}

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
    due: page.properties.期限?.date?.start ? normalizeDueToJstDate(page.properties.期限.date.start) : "",
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
