# 📥 pocket-todo

スマホから**2秒でタスクを放り込める**、AI自動分類つきのタスク入力ツール。

「思いついたタスクをNotionに入れるまでの手数が多くて、結局記録しない」問題を解決します。
1行の自由文を投げるだけで、Claude が優先度・タグ・期限を推定し、Notionのカンバンボードに登録します。

```
「明日までに経費精算 急ぎ」
        ↓ AIが解釈
  タイトル: 経費精算
  優先度: 高 / タグ: 仕事 / 期限: 2026-09-20 / ステータス: 未着手
        ↓
  Notion のカンバンボードに出現
```

## アーキテクチャ

```
iOSショートカット / Webフォーム(PWA)
        │  POST /api/tasks {text}   ← Bearerトークン認証
        ▼
Cloudflare Workers (Hono + TypeScript)
        │  202を即返し、waitUntilでバックグラウンド処理
        ├─ Claude API (claude-opus-5, 構造化出力) … 優先度/タグ/期限を推定
        └─ Notion API … タスクDBにページ作成
```

設計上のポイント:

- **応答は即返す** — AI分類(±1〜2秒)を待たせない。ショートカットの体感は一瞬
- **タスクを絶対に失わない** — 分類に失敗してもタイトルだけで登録する。Notion書き込みは1回リトライ
- **入力は1フィールドのみ** — 入力欄が増えるほど記録率は下がる。分類はAIの仕事

## セットアップ

必要なもの: [Cloudflare](https://dash.cloudflare.com/sign-up)(無料) / [Anthropic API](https://console.anthropic.com)(従量課金) / [Notionインテグレーション](https://www.notion.so/my-integrations)(無料)

```bash
npm install

# シークレットを登録
wrangler secret put AUTH_TOKEN         # 自分で決める合言葉 (openssl rand -hex 24)
wrangler secret put ANTHROPIC_API_KEY  # sk-ant-...
wrangler secret put NOTION_TOKEN       # ntn_... (対象DBへの接続を忘れずに)

# デプロイ
npm run deploy
```

`wrangler.jsonc` の `NOTION_DATA_SOURCE_ID` を自分のNotionタスクDBのデータソースIDに変更してください。
DBには `Name`(タイトル) / `ステータス`(ステータス) / `優先度`(セレクト: 高・中・低) / `期限`(日付) / `タグ`(マルチセレクト) のプロパティが必要です。

### iOSショートカットの設定

1. ショートカットアプリで新規作成 → 「テキストを要求」アクション
2. 「URLの内容を取得」アクション: `https://<your-worker>.workers.dev/api/tasks` に POST
   - ヘッダー: `Authorization: Bearer <AUTH_TOKEN>` / `Content-Type: application/json`
   - 本文: `{"text": <要求されたテキスト>}`
3. ホーム画面に追加。Siriから「タスク追加」と話しかけてもOK

### ローカル開発

```bash
cp .dev.vars.example .dev.vars  # 値を埋める
npm run dev
```

## ロードマップ

- [x] v1: 爆速入力(iOSショートカット + Webフォーム + AI分類)
- [ ] v2: 自分好みのタスクビュー
- [ ] v3: 期限リマインド (Workers Cron Triggers)
- [ ] v4: 複数ソース(カレンダー等)の集約
