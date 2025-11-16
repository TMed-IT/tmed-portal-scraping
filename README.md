# TMED Portal Scraping (Cloudflare Workers)

東邦大学医学部ポータルサイトのお知らせをCloudflare Workers上でスクレイピングし、学年別のGoogle Chatに配信します。Docker や常時稼働するサーバーは不要で、Workers の Cron Trigger が15分ごとに自動でスクレイピングを実行します。

## 主な機能

- 15分ごとにポータルサイトをスクレイピング（Workers Cron Trigger）
- 新規/更新されたお知らせの検知と Google Chat への通知
- 添付ファイルのアップロード（外部アップローダー API 経由）
- Discord へのエラーレポート
- 取得済みデータは Cloudflare D1（`notices` テーブル）に保存

## 必要条件

- [Cloudflare アカウント](https://dash.cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Node.js 18 以上（Wrangler の実行にのみ使用）

## セットアップ

1. 依存関係のインストール（Wrangler / TypeScript / Workers 型定義）
   ```bash
   npm install
   ```

2. D1 データベースの作成とマイグレーション
   ```bash
   wrangler d1 create tmed-portal-scraping
   wrangler d1 migrations apply tmed-portal-scraping --local
   wrangler d1 migrations apply tmed-portal-scraping --remote
   ```
   - 作成後に表示される `database_id` / `preview_database_id` を `wrangler.toml` の `[[d1_databases]]` に設定します。
   - ローカルの `wrangler dev` でも D1 を利用するため、`migrations/` 配下の SQL を必ず適用してください。

3. シークレット/環境変数の登録（本番/プレビューの両方で実行してください）
   ```bash
   wrangler secret put LOGIN_ID
   wrangler secret put LOGIN_PASSWORD
   wrangler secret put UPLOAD_TOKEN
   wrangler secret put UPLOAD_URL
   wrangler secret put DISCORD_WEBHOOK_URL
   wrangler secret put WEBHOOK_URL_M1
   wrangler secret put WEBHOOK_URL_M2
   wrangler secret put WEBHOOK_URL_M3
   wrangler secret put WEBHOOK_URL_M4
   wrangler secret put WEBHOOK_URL_M5
   wrangler secret put WEBHOOK_URL_M6
   ```

## ローカル開発

```bash
npm run dev
```

`wrangler dev` がローカルで Worker を起動し、
- `POST /notify` と `POST /error` が Google Chat/Discord 通知 API として動作
- Cron イベントは `wrangler dev` のターミナルから `c` キーを押して手動実行できます

TypeScript 型チェックは以下のコマンドで行えます。

```bash
npm run typecheck
```

## デプロイ

```bash
npm run deploy
```

デプロイ後は Cloudflare ダッシュボードの **Triggers** から Cron (`*/15 * * * *`) が有効になっていることを確認してください。

## プロジェクト構成

```
src/
├── index.ts      # Workers エントリーポイント（HTTP + Cron）
├── scraper.ts    # ポータルスクレイピング + D1 への保存処理
├── webhook.ts    # Google Chat/Discord 通知ロジック
└── types.ts      # 共有型定義
migrations/       # Cloudflare D1 用の SQL マイグレーション
```

- `wrangler.toml` : Workers 設定。Cron、D1 バインディング等を定義。
- `package.json`   : Wrangler 実行用スクリプト。

## HTTP エンドポイント

| メソッド | パス      | 説明                                   |
| -------- | --------- | -------------------------------------- |
| POST     | `/notify` | スクレイパー結果を手動送信するためのAPI |
| POST     | `/error`  | エラー内容を Discord に転送             |
| GET      | `/healthz`| 簡易ヘルスチェック                     |

## 環境変数一覧

| 変数名              | 用途                                    |
| ------------------- | --------------------------------------- |
| `LOGIN_ID`            | ポータルログイン ID                       |
| `LOGIN_PASSWORD`      | ポータルログイン パスワード               |
| `UPLOAD_URL`          | 添付ファイルを送信する API エンドポイント |
| `UPLOAD_TOKEN`        | 添付ファイル API 認証トークン            |
| `WEBHOOK_URL_M1-6`    | 学年別 Google Chat Webhook URL           |
| `DISCORD_WEBHOOK_URL` | エラーログ送信用 Discord Webhook         |
| `DB`（D1 binding）    | 保存済みお知らせを保持する Cloudflare D1 |

これらのシークレット値は `wrangler secret put <NAME>` で登録します。`DB` は `wrangler.toml` の D1 バインディングにより自動的に注入されるため、追加の登録は不要です。

## ライセンス

ISC
