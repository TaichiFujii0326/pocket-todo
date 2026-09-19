# pocket-todo 開発ガイド

個人用タスク入力ツール。用語は [CONTEXT.md](./CONTEXT.md)、設計決定は [docs/adr/](./docs/adr/) を先に読むこと。

## 開発サイクル

機能追加・大きめの変更は、このサイクルで進める:

1. **仕様のグリル** — `/grill-with-docs` で設計ツリーを1問ずつ詰め、合意した決定のうち「戻しにくい・文脈なしだと不可解・実際に別案があった」ものだけを `docs/adr/` に、新しい用語は `CONTEXT.md` に落とす
2. **実装** — 合意した最小スコープだけ作る。デプロイは `npm run deploy`
3. **クロスレビュー** — セキュリティや設計に触れる変更は、Orcaのターミナル経由でCodexを起動し第三者レビューさせる(レポートは `docs/reviews/YYYY-MM-DD-codex-*.md` に書かせる)。指摘は鵜呑みにせず妥当性を検証し、**対応/受容を明示的に仕分ける**(受容理由はADRかコミットメッセージに残す)
4. **レビュー対応** — 妥当な指摘を修正し、回帰テストを追加
5. **E2E検証** — `npm run test:e2e`。本番相手はトークン必須の書き込み系がskipされるので、フルは ローカル: `.dev.vars` にダミー値 → `wrangler dev` → `POCKET_TODO_URL=http://localhost:8787 POCKET_TODO_TOKEN=devtoken npm run test:e2e`。UIの対話デバッグにはPlaywright MCPを使う
6. **コミット** — 機能とレビュー対応は別コミットに分け、コミットメッセージに「なぜ」を書く

## 原則

- タスクを絶対に失わない(解釈失敗はフォールバック登録)。既存タスクへの操作は誤爆より空振り(ADR-0004)
- 全体俯瞰のUIはNotionの仕事。このツールは「入れる」「今日を見る」「知らせる」だけ(ADR-0001)
- シークレットの値をチャット・コミット・ログに出さない。値の受け渡しは `pbcopy` / stdinパイプで行う
- **トークンローテーション手順**(露出時は即実施): ① `openssl rand -hex 24 | pbcopy` で新値生成 → ② `wrangler secret put AUTH_TOKEN` → ③ `POST /api/push/reset`(新トークンで)を叩いて**プッシュ購読を全破棄** — 旧トークンで登録された購読はローテーションだけでは無効化されないため → ④ 各端末でフォームに新トークンを入れ直し、通知を再有効化
- 外部通知サービス(特にntfy)を再提案しない(ADR-0005)

## よく使うコマンド

```bash
npm run typecheck        # 型チェック
npm run deploy           # 本番デプロイ(Cloudflare Workers)
npm run test:e2e         # Playwrightテスト(本番相手。POCKET_TODO_TOKENで書き込み系も実行)
npx wrangler secret list # シークレット確認
npx wrangler tail        # 本番ログの観察
```
