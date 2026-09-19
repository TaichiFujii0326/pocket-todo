# 📥 pocket-todo

スマホから**2秒でタスクを放り込める**、AI自動分類つきのタスク入力ツール。

「思いついたタスクをNotionに入れるまでの手数が多くて、結局記録しない」問題を解決します。
1行の自由文を投げるだけで、Claude が意図を判定し、Notionのカンバンボードを操作します。

- 「明日までに経費精算 急ぎ」 → **新規登録**(優先度・タグ・期限を自動推定)
- 「経費精算おわった」 → 該当タスクを**完了**に
- 「READMEの件やり始めた」 → **進行中**に
- 「バス予約のタスク消して」 → **ゴミ箱**へ(30日以内は復元可)

完了・削除などの操作結果はWeb Pushで手元に通知されます。対象を特定できないときは操作せず、その旨を通知します(誤爆より空振り)。

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
        ├─ Claude API (claude-haiku-4-5, 構造化出力) … 意図判定と優先度/タグ/期限の推定
        └─ Notion API … タスクDBにページ作成
```

設計上のポイント:

- **応答は即返す** — AI分類(±1〜2秒)を待たせない。ショートカットの体感は一瞬
- **タスクを絶対に失わない** — 分類に失敗してもタイトルだけで登録する。Notion書き込みは1回リトライ
- **入力は1フィールドのみ** — 入力欄が増えるほど記録率は下がる。分類はAIの仕事

## セキュリティ設計

トークン漏洩時の課金悪用を想定した多層防御:

1. **ハードリミット** — Anthropic APIはプリペイド式で自動リロードをOFFにしておく。最悪でも被害は残高まで
2. **減速装置** — Worker内レートリミット(認証通過後のリクエストを毎分5件まで、超過は429)。近似カウンタのためバースト時は多少の超過を許容するが、持続的な悪用は絞られる。クレジットが溶ける速度を抑え、異変に気づく時間を稼ぐ
3. **遮断** — `wrangler secret put AUTH_TOKEN` でトークンを即ローテーション可能

## セットアップ

必要なもの: [Cloudflare](https://dash.cloudflare.com/sign-up)(無料) / [Anthropic API](https://console.anthropic.com)(従量課金) / [Notionインテグレーション](https://www.notion.so/my-integrations)(無料)

```bash
npm install

# シークレットを登録
wrangler secret put AUTH_TOKEN         # 自分で決める合言葉 (openssl rand -hex 24)
wrangler secret put ANTHROPIC_API_KEY  # sk-ant-...
wrangler secret put NOTION_TOKEN       # ntn_... (対象DBへの接続を忘れずに)

# Web Push用のVAPID鍵 (npx web-push generate-vapid-keys で生成)
wrangler secret put VAPID_PRIVATE_KEY  # 秘密鍵。公開鍵とmailtoは wrangler.jsonc の vars に設定


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

## 開発フロー

AIエージェントを組み合わせた開発サイクルで運用しています([CLAUDE.md](./CLAUDE.md)に詳細):

```
仕様のグリル(/grill-with-docs) → ADR/用語集に決定を記録 → 実装
→ 別AI(Codex)による第三者レビュー → 指摘を検証して対応 or 受容
→ Playwright E2E(ローカル+本番) → コミット
```

実例: [セキュリティレビューと対応](./docs/reviews/)、[ADR-0005(レビュー起点でntfy→Web Pushへ転換)](./docs/adr/0005-web-push-over-ntfy.md)

## 設計ドキュメント

- [docs/architecture.html](./docs/architecture.html) — インフラ構成図(コード根拠で作成した対話型HTML。クローンしてブラウザで開く)
- [CONTEXT.md](./CONTEXT.md) — このプロジェクトの用語集
- [docs/adr/](./docs/adr/) — 主要な設計決定の記録(なぜNotionか、なぜWeb Pushか、など)
- [docs/reviews/](./docs/reviews/) — 外部AI(Codex)によるセキュリティ監査レポート(対応・受容の判断はコミットメッセージとADRに記録)

## ロードマップ

- [x] v1: 爆速入力(iOSショートカット + Webフォーム + AI分類)
- [x] v2: 今日ビュー — フォーム下に「🔥期限超過 / 📌今日が期限 / ⚡期限なし高優先」を表示。タップで完了。全体俯瞰はNotionのカンバンに任せる分担のまま
- [x] v3: 期限リマインド — 毎朝8時(JST)に「期限が今日/超過」の未完了タスクを**自前のWeb Push**(VAPID + Service Worker)でプッシュ通知。外部の通知サービスに依存せず、フォームのPWAがそのまま通知を受け取る。該当なしの日は通知しない
- [ ] v4: 複数ソース(カレンダー等)の集約
