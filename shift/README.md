# みら勤務表 v15 readable fix

v14の `schedule.js` が1行圧縮状態で読みにくく、さらに `date is not defined` が出ていたため、読みやすい通常のJavaScriptに戻した版です。

## 修正内容

- `schedule.js` を整形済みの読みやすいコードへ変更
- `createDayCell()` 内の祝日名表示で、未定義変数 `date` ではなく引数 `date` を正しく使う形へ整理
- 祝日名を `祝 元日` のようにセル表示
- `holidays.json` はGit管理せず、GitHub Actionsで生成

## ローカル確認

祝日込みで見る場合:

```powershell
cd shift
python tools/update_holidays.py
cd ..
python -m http.server 8000
```

ブラウザ:

```text
http://localhost:8000/shift/
```

## GitHub Actions

`.github/workflows/pages.yml` は以下をします。

1. `cd shift`
2. `python tools/update_holidays.py`
3. `path: .` でリポジトリ直下をPages artifact化
4. GitHub Pagesへデプロイ
