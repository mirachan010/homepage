# 祝日データの担当範囲

## 結論

祝日データの取得とD1への反映は **Cloudflare Worker** が担当します。
GitHub Actionsは使用しません。リポジトリを長期間更新しなくても同期を止めないためです。

## 公式データ

- メタデータ提供元: e-Govデータポータル
- データセットキー: `cao_20190522_0002`
- 既知のリソースID: `d9ad35a5-6c9c-4127-bdbe-aa138fdffe42`
- 実データ提供元: 内閣府「国民の祝日」CSV
- CSV URL: `https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv`

Workerはe-Govの `package_show` APIから毎回リソースを確認し、内閣府のHTTPS URLで
あることを検証してからCSVを取得します。CSV URLを無条件には信用しません。

## 更新方法

- Cloudflare Cron Triggerが毎月3日 03:00 UTC（日本時間12:00）に確認
- CSVのSHA-256が前回と同じなら、祝日行は書き換えず同期履歴だけ追加
- 内容が変わった場合だけ、公式祝日をD1へ一括反映
- 認証済み編集画面から手動同期も可能
- 取得失敗時は既存のD1データを維持し、失敗内容を同期履歴へ記録

## D1へ保存するもの

- `holidays`: 公式CSVに掲載された日付、名称、反映元の同期ID
- `holiday_sync_runs`: 取得日時、起動元、データセット/リソースID、URL、
  Last-Modified、ETag、SHA-256、件数、対象期間、成功/失敗

祝日は日付を主キーとしているため、カレンダー表示では対象期間の数行だけを読みます。
同期履歴は月1行なので、60年間でも約720行です。

## 未公表年

公式CSVにまだ掲載されていない年は、`worker/schedule.js` と
`public/shift/holidays.js` の規則計算を「暫定」として使用します。
春分・秋分の日を含め、正式公表後はD1の公式データが優先されます。

## 日本の制度や提供方法が変わった場合

1. e-Govのデータセットが移動した場合は `worker/holidays.js` の
   `DATASET_KEY` とリソース選択条件を修正
2. CSV形式・文字コードが変わった場合は同ファイルの
   `parseOfficialHolidayCsv` を修正
3. 祝日の決め方自体が変わった場合は、公式CSVが更新されれば通常はコード変更不要
4. 未公表年の暫定表示規則も変わる場合は、Workerとブラウザの計算コードを修正

公開API `/api/v1/holidays?year=YYYY` は、その年が公式データか暫定計算かと、
公式データの場合の出典情報を返します。
