# TMED Portal Scraping

東邦大学医学部ポータルサイトのお知らせを自動的にスクレイピングし、Google Chatに通知するシステムです。

## 機能

- 15分ごとにポータルサイトをスクレイピング
- 新規投稿と更新された投稿を検知
- 学年別のGoogle Chatに通知
- 投稿内容をMarkdown形式で保存

## 必要条件

- Node.js 18以上
- Docker と Docker Compose

## 環境変数

`.env`ファイルを作成し、以下の環境変数を設定してください：

```env
LOGIN_ID=
LOGIN_PASSWORD=
PORT=3000                           # Webhookサーバーのポート
WEBHOOK_URL=http://localhost:3000   # WebhookサーバーのURL

UPLOAD_TOKEN=  # uploadAPI(CDN) SecretToken
UPLOAD_URL=    # uploadAPI(CDN) URL

# Google Chat Webhook URLs
WEBHOOK_URL_M1=             # M1向けWebhook URL
WEBHOOK_URL_M2=             # M2向けWebhook URL
WEBHOOK_URL_M3=             # M3向けWebhook URL
WEBHOOK_URL_M4=             # M4向けWebhook URL
WEBHOOK_URL_M5=             # M5向けWebhook URL
WEBHOOK_URL_M6=             # M6向けWebhook URL

DISCORD_WEBHOOK_URL=　#エラー通知用のdiscord Webhook URL
```

## インストールと実行

1. リポジトリをクローン：
```bash
git clone [repository-url]
cd tmed-portal-scraping
```

2. 環境変数の設定：
```bash
cp .env.example .env
# .envファイルを編集して必要な値を設定
```

3. Dockerコンテナの起動：
```bash
docker compose up -d
```

## アーキテクチャ

システムは2つのコンテナで構成されています：

1. **Scraper**（`src/scraper.js`）
   - ポータルサイトのスクレイピング
   - 投稿内容の解析と保存
   - 添付ファイルのアップロード (`src/uploader.js`)
   - Webhookサーバーへの通知

2. **Webhook**（`src/webhook.js`）
   - 通知の受信
   - Google Chatへのメッセージ送信
   - 学年別の通知振り分け

## データ保存

- `data/responses/`: スクレイピングしたデータのJSON
