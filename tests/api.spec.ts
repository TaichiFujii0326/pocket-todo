import { expect, test } from "@playwright/test";

const TOKEN = process.env.POCKET_TODO_TOKEN;

test.describe("API", () => {
  test("GET / serves the capture form", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("pocket-todo");
  });

  test("POST /api/tasks without auth is rejected", async ({ request }) => {
    const res = await request.post("/api/tasks", { data: { text: "x" } });
    expect(res.status()).toBe(401);
  });

  test("POST /api/tasks with a wrong token is rejected", async ({ request }) => {
    const res = await request.post("/api/tasks", {
      headers: { Authorization: "Bearer wrong-token" },
      data: { text: "x" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /api/remind without auth is rejected", async ({ request }) => {
    const res = await request.post("/api/remind");
    expect(res.status()).toBe(401);
  });

  test("POST /api/tasks with non-string text is a 400", async ({ request }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    const res = await request.post("/api/tasks", {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { text: 123 },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/tasks with too-long text is a 400", async ({ request }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    const res = await request.post("/api/tasks", {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { text: "あ".repeat(501) },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/tasks with an invalid JSON body is a 400", async ({ request }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    const res = await request.post("/api/tasks", {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: "this is not json",
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/tasks with empty text is a 400", async ({ request }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    const res = await request.post("/api/tasks", {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { text: "   " },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /api/tasks with a valid task is accepted immediately", async ({ request }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    const started = Date.now();
    const res = await request.post("/api/tasks", {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { text: "E2Eテスト APIからの登録" },
    });
    expect(res.status()).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    // AI分類を待たずに応答が返る(バックグラウンド処理)ことの確認
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
