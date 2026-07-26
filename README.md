# mirachan.net

Cloudflare Workers、D1、Accessで動かす個人サイトと勤務表です。

## 構成

- `public/`: 公開するHTML、CSS、JavaScript
- `worker/`: 公開勤務データと編集処理
- `migrations/`: D1のテーブルと初期データ
- `public/shift/edit/`: Cloudflare Accessで保護する編集画面

勤務表は、基本周期・基準日の変更履歴・通常と違う日のみをD1へ保存します。
日本の祝日は `public/shift/holidays.js` がブラウザ上で算出するため、年次更新用の
GitHub Actionsは不要です。

## ローカル確認

```powershell
npm install
npm run db:migrate:local
npm run dev
```

`http://localhost:8787/shift/` で公開勤務表、
`http://localhost:8787/shift/edit/` で編集画面を確認できます。

## 初回のCloudflare設定

1. `npx wrangler login`
2. `npx wrangler d1 create mira-schedule`
3. 表示されたIDを `wrangler.jsonc` の `database_id` に設定
4. `npm run db:migrate:remote`
5. `npm run deploy`
6. Workerへ `mirachan.net` のカスタムドメインを設定
7. Cloudflare Accessで次のパスを本人だけに制限
   - `mirachan.net/shift/edit/*`
   - `mirachan.net/api/admin/*`
8. Accessの保護を確認後、`wrangler.jsonc` の `ADMIN_ENABLED` を `true` にして再デプロイ

現在は、次のパスをCloudflare Accessで保護済みです。

- `mirachan.net/shift/edit/*`
- `mirachan.net/api/admin/*`
- `mirachan-homepage.mirachan010.workers.dev/shift/edit/*`
- `mirachan-homepage.mirachan010.workers.dev/api/admin/*`

許可ポリシーは `mirachan010@gmail.com` のみです。

認証情報やAPIトークンはリポジトリへ保存しません。

## 公開API

外部サービスから利用する読み取り専用APIです。すべて日本時間を基準にし、
個人的なメモ、変更理由、DBの内部情報は返しません。

| パス | 内容 |
| --- | --- |
| `/api/v1/` | API一覧 |
| `/api/v1/status` | 今日・次の仕事・次の休み |
| `/api/v1/today` | 今日の勤務状態 |
| `/api/v1/next-rest` | 次の休み |
| `/api/v1/month?year=2026&month=8` | 指定月の勤務表 |
| `/api/v1/holidays?year=2026` | 指定年の日本の祝日 |

公開APIは `GET` と `HEAD` に対応し、ブラウザ等から利用できるよう
`Access-Control-Allow-Origin: *` を返します。仕様変更が必要になった場合は
`/api/v2/` を追加し、`v1` の応答形式は維持します。
