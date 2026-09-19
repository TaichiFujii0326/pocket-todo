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
    margin: 0 auto; max-width: 520px;
    padding: calc(20px + env(safe-area-inset-top, 0px)) 20px calc(24px + env(safe-area-inset-bottom, 0px));
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
    background: #f5f5f4; color: #1c1917;
    display: flex; flex-direction: column; gap: 14px; min-height: 100dvh; box-sizing: border-box;
  }
  header { display: flex; align-items: center; gap: 10px; }
  header img { width: 30px; height: 30px; border-radius: 8px; }
  h1 { font-size: 20px; margin: 0; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input {
    font-size: 18px; padding: 14px 16px; border: 1px solid #d6d3d1;
    border-radius: 12px; outline: none; background: #fff; color: #1c1917;
  }
  input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.18); }
  button { transition: transform 0.1s; }
  button:active { transform: scale(0.97); }
  /* ダークモード上書きは、素のinput/bodyルールより後に置くこと(同じ詳細度のため後勝ち) */
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    input { background: #292524; color: #fafaf9; border-color: #44403c; }
  }
  button {
    font-size: 17px; font-weight: 600; padding: 14px; border: none;
    border-radius: 12px; background: linear-gradient(135deg, #6366f1, #4338ca); color: #fff;
  }
  button:disabled { opacity: 0.5; }
  #status { font-size: 14px; min-height: 20px; }
  #status.ok { color: #16a34a; }
  #status.err { color: #dc2626; }
  .hint { font-size: 12px; color: #78716c; }
  #pushBtn {
    background: transparent; color: #6366f1; border: 1px solid #6366f1;
    font-size: 14px; padding: 10px; margin-top: auto;
  }
  #pushStatus { font-size: 12px; color: #78716c; min-height: 16px; }
  .vhead { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; }
  .vhead h2 { font-size: 16px; margin: 0; }
  #refreshBtn {
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    font-size: 13px; padding: 6px 12px; color: #57534e;
  }
  @media (prefers-color-scheme: dark) {
    #refreshBtn { background: #292524; border-color: #44403c; color: #d6d3d1; }
  }
  .tsec { font-size: 13px; font-weight: 600; color: #78716c; margin: 10px 0 4px; }
  .trow {
    display: flex; align-items: center; gap: 10px; padding: 11px 12px;
    background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; margin-bottom: 6px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    transition: opacity 0.25s ease, transform 0.25s ease;
  }
  .trow.gone { opacity: 0; transform: translateX(16px); }
  .tdone {
    width: 24px; height: 24px; border-radius: 50%; border: 2px solid #a8a29e;
    background: transparent; padding: 0; flex: none;
  }
  .tdone:active { background: #6366f1; border-color: #6366f1; }
  .ttl { font-size: 15px; flex: 1; overflow-wrap: anywhere; }
  .tmeta { font-size: 12px; color: #dc2626; flex: none; }
  .tmeta.future { color: #78716c; }
  .empty { font-size: 14px; color: #78716c; padding: 14px 0; text-align: center; }
  summary.tsec { cursor: pointer; user-select: none; }
  @media (prefers-color-scheme: dark) {
    .trow { background: #292524; border-color: #44403c; box-shadow: none; }
  }
</style>
</head>
<body>
<header><img src="/icon.png" alt=""><h1>pocket-todo</h1></header>
<form id="f">
  <input id="text" type="text" placeholder="例: 明日までに経費精算 急ぎ" autocomplete="off" autofocus>
  <button id="btn" type="submit">送る</button>
</form>
<div id="status"></div>
<p class="hint">優先度・タグ・期限はAIが自動で推定してNotionに登録します。<br>「経費精算おわった」「バス予約のタスク消して」のように書くと、完了・削除などの操作もできます(結果は通知でお知らせ)。</p>
<section id="todayView" hidden>
  <div class="vhead">
    <h2>今日なにやる？</h2>
    <button id="refreshBtn" type="button">🔄 更新</button>
  </div>
  <div id="taskList"></div>
</section>
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
      status.className = "ok"; status.textContent = "✅ 送りました";
      setTimeout(() => { if (status.className === "ok") { status.textContent = ""; status.className = ""; } }, 3000);
      $("text").value = "";
      $("text").focus();
      // バックグラウンドのAI処理(1〜3秒)が終わった頃に今日ビューを更新
      setTimeout(loadToday, 4000);
    } catch (err) {
      status.className = "err"; status.textContent = "⚠️ " + err.message;
    } finally {
      $("btn").disabled = false;
    }
  });

  // ---- 今日ビュー ----
  function storedToken() {
    try { return localStorage.getItem("pocket-todo-token"); } catch { return null; }
  }
  async function loadToday() {
    const token = storedToken();
    if (!token) return; // トークン未設定の間は非表示のまま
    try {
      const res = await fetch("/api/today", { headers: { Authorization: "Bearer " + token.trim() } });
      if (!res.ok) return;
      renderToday(await res.json());
    } catch {}
  }
  function renderToday(data) {
    const list = $("taskList");
    $("todayView").hidden = false;
    list.textContent = "";
    const sections = [
      ["🔥 期限超過", data.overdue, "overdue"],
      ["📌 今日が期限", data.dueToday, ""],
      ["⚡ 優先度高", data.highPriority, "future"],
    ];
    let total = 0;
    for (const [label, items, showDue] of sections) {
      if (!items || items.length === 0) continue;
      total += items.length;
      const head = document.createElement("div");
      head.className = "tsec";
      head.textContent = label + " (" + items.length + ")";
      list.appendChild(head);
      for (const task of items) {
        const row = document.createElement("div");
        row.className = "trow";
        const done = document.createElement("button");
        done.type = "button";
        done.className = "tdone";
        done.setAttribute("aria-label", "完了にする");
        done.addEventListener("click", () => completeTask(task, row));
        const title = document.createElement("div");
        title.className = "ttl";
        title.textContent = task.title;
        row.appendChild(done);
        row.appendChild(title);
        if (showDue && task.due) {
          const meta = document.createElement("div");
          meta.className = showDue === "future" ? "tmeta future" : "tmeta";
          meta.textContent = task.due.slice(5).replace("-", "/") + (showDue === "future" ? "まで" : "〜");
          row.appendChild(meta);
        }
        list.appendChild(row);
      }
    }
    if (total === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "今日のタスクはありません🎉";
      list.appendChild(empty);
    }
    // 近日(7日以内)は折りたたみで。朝イチの1画面目は「今日」で完結させる
    if (data.upcoming && data.upcoming.length > 0) {
      const det = document.createElement("details");
      const sum = document.createElement("summary");
      sum.className = "tsec";
      sum.textContent = "📅 近日 (" + data.upcoming.length + "件)";
      det.appendChild(sum);
      for (const task of data.upcoming) {
        const row = document.createElement("div");
        row.className = "trow";
        const done = document.createElement("button");
        done.type = "button";
        done.className = "tdone";
        done.setAttribute("aria-label", "完了にする");
        done.addEventListener("click", () => completeTask(task, row));
        const title = document.createElement("div");
        title.className = "ttl";
        title.textContent = task.title;
        const meta = document.createElement("div");
        meta.className = "tmeta future";
        meta.textContent = task.due.slice(5).replace("-", "/") + "まで";
        row.appendChild(done);
        row.appendChild(title);
        row.appendChild(meta);
        det.appendChild(row);
      }
      list.appendChild(det);
    }
  }
  async function completeTask(task, row) {
    row.style.opacity = "0.4";
    try {
      const res = await fetch("/api/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (storedToken() || "").trim() },
        body: JSON.stringify({ id: task.id }),
      });
      if (!res.ok) throw new Error();
      row.classList.add("gone");
      setTimeout(() => {
        row.remove();
        if (!$("taskList").querySelector(".trow")) loadToday();
      }, 250);
    } catch {
      row.style.opacity = "1";
      const s = $("status");
      s.className = "err";
      s.textContent = "⚠️ 完了にできませんでした";
      setTimeout(() => { s.textContent = ""; s.className = ""; }, 4000);
    }
  }
  $("refreshBtn").addEventListener("click", loadToday);
  // ホーム画面アプリを開き直した/前面に戻したときに自動で最新化する
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadToday();
  });
  loadToday();

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
      // サーバー登録まで完了した証跡(フラグ)も確認する。ブラウザ側の購読だけ
      // 成功してサーバー保存に失敗した状態を「有効」と誤表示しないため
      let registered = null;
      try { registered = localStorage.getItem("pocket-todo-push-registered"); } catch {}
      if (sub && registered && Notification.permission === "granted") {
        pushStatus.textContent = "🔔 通知は有効です(毎朝8時)";
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
      try { localStorage.setItem("pocket-todo-push-registered", "1"); } catch {}
      pushStatus.textContent = "✅ 通知を有効にしました";
      $("pushBtn").hidden = true;
    } catch (err) {
      pushStatus.textContent = "⚠️ " + err.message;
    }
  });
</script>
</body>
</html>`;
