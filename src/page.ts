// スマホのホーム画面に追加して使う最小の入力フォーム。
// APIトークンは初回入力時にlocalStorageへ保存する(自分専用ツールのための簡易方式)。
export const formPage = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon.png">
<title>pocket-todo</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: calc(24px + env(safe-area-inset-top, 0px)) 20px 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
    background: #f5f5f4; color: #1c1917;
    display: flex; flex-direction: column; gap: 16px; min-height: 100dvh; box-sizing: border-box;
  }
  h1 { font-size: 20px; margin: 0; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input {
    font-size: 18px; padding: 14px 16px; border: 1px solid #d6d3d1;
    border-radius: 12px; outline: none; background: #fff; color: #1c1917;
  }
  input:focus { border-color: #2563eb; }
  /* ダークモード上書きは、素のinput/bodyルールより後に置くこと(同じ詳細度のため後勝ち) */
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    input { background: #292524; color: #fafaf9; border-color: #44403c; }
  }
  button {
    font-size: 17px; font-weight: 600; padding: 14px; border: none;
    border-radius: 12px; background: #2563eb; color: #fff;
  }
  button:disabled { opacity: 0.5; }
  #status { font-size: 14px; min-height: 20px; }
  #status.ok { color: #16a34a; }
  #status.err { color: #dc2626; }
  .hint { font-size: 12px; color: #78716c; }
  #pushBtn {
    background: transparent; color: #2563eb; border: 1px solid #2563eb;
    font-size: 14px; padding: 10px; margin-top: auto;
  }
  #pushStatus { font-size: 12px; color: #78716c; min-height: 16px; }
</style>
</head>
<body>
<h1>📥 pocket-todo</h1>
<form id="f">
  <input id="text" type="text" placeholder="例: 明日までに経費精算 急ぎ" autocomplete="off" autofocus>
  <button id="btn" type="submit">タスクを放り込む</button>
</form>
<div id="status"></div>
<p class="hint">優先度・タグ・期限はAIが自動で推定してNotionに登録します。</p>
<button id="pushBtn" type="button">🔔 期限リマインド通知を有効にする</button>
<div id="pushStatus"></div>
<script>
  const $ = (id) => document.getElementById(id);
  function getToken() {
    let t = null;
    try { t = localStorage.getItem("pocket-todo-token"); } catch {}
    if (!t) {
      t = prompt("APIトークンを入力してください(初回のみ)");
      if (t) { try { localStorage.setItem("pocket-todo-token", t.trim()); } catch {} }
    }
    return t ? t.trim() : null;
  }
  $("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("text").value.trim();
    if (!text) return;
    const token = getToken();
    if (!token) return;
    const status = $("status");
    $("btn").disabled = true;
    status.className = ""; status.textContent = "送信中…";
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ text }),
      });
      if (res.status === 401) {
        try { localStorage.removeItem("pocket-todo-token"); } catch {}
        throw new Error("トークンが違います。再読み込みして入力し直してください");
      }
      if (res.status === 429) {
        throw new Error("送信が多すぎます。1分ほど待ってから再試行してください");
      }
      if (!res.ok) throw new Error("送信に失敗しました (" + res.status + ")");
      status.className = "ok"; status.textContent = "✅ 放り込みました";
      $("text").value = "";
      $("text").focus();
    } catch (err) {
      status.className = "err"; status.textContent = "⚠️ " + err.message;
    } finally {
      $("btn").disabled = false;
    }
  });

  // ---- Web Push (期限リマインド通知) ----
  const VAPID_PUBLIC_KEY = "__VAPID_PUBLIC_KEY__";
  function urlB64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  }
  const pushStatus = $("pushStatus");
  async function refreshPushStatus() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        pushStatus.textContent = "🔔 通知は有効です(毎朝8時、期限のあるタスクがある日だけ届きます)";
        $("pushBtn").hidden = true;
      }
    } catch {}
  }
  refreshPushStatus();
  $("pushBtn").addEventListener("click", async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        throw new Error("この環境は通知非対応です。iPhoneでは「ホーム画面に追加」したアイコンから開いてください");
      }
      const token = getToken();
      if (!token) return;
      pushStatus.textContent = "設定中…";
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("通知が許可されませんでした");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error("登録に失敗しました (" + res.status + ")");
      pushStatus.textContent = "✅ 通知を有効にしました";
      $("pushBtn").hidden = true;
    } catch (err) {
      pushStatus.textContent = "⚠️ " + err.message;
    }
  });
</script>
</body>
</html>`;
