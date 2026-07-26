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

現在の `workers.dev` 環境では、次のパスをCloudflare Accessで保護済みです。

- `mirachan-homepage.mirachan010.workers.dev/shift/edit/*`
- `mirachan-homepage.mirachan010.workers.dev/api/admin/*`

許可ポリシーは `mirachan010@gmail.com` のみです。カスタムドメインを追加する際も、
同じ2つのパスをAccessへ追加してからWorkerへ接続します。

認証情報やAPIトークンはリポジトリへ保存しません。
