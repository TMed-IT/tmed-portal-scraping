# TMED Portal Scraping

TMEDポータルからデータをスクレイピングするNode.jsアプリケーション

## 機能

- 指定されたURLからのデータスクレイピング
- 定期実行（デフォルト：毎日午前9時）
- ログ出力（Winston）
- Dockerコンテナ化

## 必要条件

- Node.js 18以上
- Docker
- Docker Compose

## セットアップ

1. リポジトリのクローン
```bash
git clone [repository-url]
cd tmed-portal-scraping
```

2. 環境変数の設定
`.env`ファイルを作成し、必要な環境変数を設定：
```
TARGET_URL=https://example.com
```

3. Dockerコンテナの起動
```bash
docker-compose up -d
```

## ログの確認

ログは`logs`ディレクトリに出力されます：
- `combined.log`: すべてのログ
- `error.log`: エラーログのみ

## 定期実行の設定

`src/index.js`の`cron.schedule()`で定期実行のスケジュールを設定できます。
デフォルトは毎日午前9時（`0 9 * * *`）に実行されます。

## 開発

1. 依存関係のインストール
```bash
npm install
```

2. アプリケーションの実行
```bash
npm start
``` 