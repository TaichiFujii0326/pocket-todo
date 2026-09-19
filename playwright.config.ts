import { defineConfig, devices } from "@playwright/test";

// 本番Workerに対して実行するE2Eテスト。
// POCKET_TODO_TOKEN に AUTH_TOKEN を渡すと、実際にタスクを作るテストも走る
// (渡さない場合、書き込み系テストは自動でskipされる)。
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.POCKET_TODO_URL ?? "https://pocket-todo.pocket-todo.workers.dev",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
