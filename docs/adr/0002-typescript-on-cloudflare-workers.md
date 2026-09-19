# TypeScript + Cloudflare Workers を採用する

作者の主力言語はPHP/Go/Pythonだが、あえてTypeScript + Hono + Cloudflare Workersを選んだ。理由は (1) Workersはコールドスタートが実質ゼロで「2秒で放り込む」体感に直結する、(2) cron・KV・レートリミットが同一プラットフォームに揃っていてリマインド等を追加インフラなしで積める、(3) 無料枠で常時運用できる、(4) ポートフォリオとしてTS/エッジの実績を足す学習価値、の4点。

## Considered Options

- Go + Cloud Run — 書き慣れた言語で最短完成。ただしコールドスタート約1秒、cronはCloud Scheduler別設定。次点だった
- Python + Workers(ベータ) — ベータ縛りが初学者に厳しく却下
- PHP — 無料サーバーレスの選択肢が乏しく却下
