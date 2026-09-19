import { devices, expect, test } from "@playwright/test";

const TOKEN = process.env.POCKET_TODO_TOKEN;
const STORAGE_KEY = "pocket-todo-token";

test.describe("UI", () => {
  test("form renders with input and submit button", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#text")).toBeVisible();
    await expect(page.locator("#btn")).toBeVisible();
    await expect(page.locator("#btn")).toContainText("送る");
  });

  test("first submit prompts for the token, then succeeds", async ({ page }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    await page.goto("/");
    page.once("dialog", (dialog) => dialog.accept(TOKEN!));
    await page.fill("#text", "E2Eテスト UIからの登録");
    await page.click("#btn");
    await expect(page.locator("#status")).toContainText("送りました");
    await expect(page.locator("#text")).toHaveValue("");
  });

  test("stored token is reused without prompting", async ({ page }) => {
    test.skip(!TOKEN, "POCKET_TODO_TOKEN not set");
    await page.goto("/");
    await page.evaluate(
      ([key, token]) => localStorage.setItem(key, token),
      [STORAGE_KEY, TOKEN!],
    );
    // dialogハンドラを登録しない = promptが出たらテストはタイムアウトで落ちる
    await page.fill("#text", "E2Eテスト 保存済みトークンでの登録");
    await page.click("#btn");
    await expect(page.locator("#status")).toContainText("送りました");
  });

  test("wrong stored token shows an error and clears it", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((key) => localStorage.setItem(key, "wrong-token"), STORAGE_KEY);
    await page.fill("#text", "should fail");
    await page.click("#btn");
    await expect(page.locator("#status")).toContainText("トークンが違います");
    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    expect(stored).toBeNull();
  });
});

// "rgb(r, g, b)" -> 0(黒)〜1(白) の簡易輝度
function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`UI (${colorScheme} mode)`, () => {
    test.use({ colorScheme });

    test("input text is readable against its background", async ({ page }) => {
      await page.goto("/");
      const styles = await page.locator("#text").evaluate((el) => {
        const s = getComputedStyle(el);
        return { color: s.color, background: s.backgroundColor };
      });
      // 文字色と背景色の輝度差が十分にあること(白文字×白背景の再発防止)
      expect(
        Math.abs(luminance(styles.color) - luminance(styles.background)),
      ).toBeGreaterThan(0.4);
    });
  });
}

test.describe("UI (iPhone viewport)", () => {
  const { defaultBrowserType: _unused, ...iphone } = devices["iPhone 14"];
  test.use(iphone);

  test("form is usable at phone size", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#text")).toBeVisible();
    await expect(page.locator("#btn")).toBeVisible();
    // 横スクロールが発生していないこと
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
