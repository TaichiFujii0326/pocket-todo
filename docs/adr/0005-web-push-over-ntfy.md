# リマインド通知は自前のWeb Push。ntfy.shは使わない

当初リマインドはntfy.shへの送信で実装したが、本番で即座に429(daily message quota reached)に当たった。原因は、ntfy.shの無料枠が送信元IP単位で課金されることにある: Cloudflare Workersからの送信は共有egress IPから出るため、世界中の他ユーザーと同じ枠を取り合い、自分が1通も送っていなくても枯渇する。無料アカウントのトークン認証でも `limits.basis` は `ip` のままで解決しなかった(有料プランのみアカウント単位になる)。そこでWeb Pushプロトコル(VAPID + Service Worker + KVでの購読管理)を自前実装し、ブラウザのプッシュ基盤へ直接送る構成に切り替えた。外部通知サービスへの依存がゼロになり、費用もかからない。

## Considered Options

- ntfy.sh — 上記のIP枠問題で不成立。**WorkersのようなIP共有環境からntfyへの送信は今後も同じ理由で失敗する**ので再提案しないこと
- Discord/Telegram webhook — 動くが外部サービス依存が残るため次点
- iOSショートカット自動化(端末側ポーリング) — 依存ゼロだが通知の信頼性が端末設定に左右される
