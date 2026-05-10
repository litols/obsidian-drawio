# E2E テスト用フィクスチャ Vault

このディレクトリは Playwright E2E テストが使用するフィクスチャ Vault です。

## ディレクトリ構成

```
e2e-vault/
  .obsidian/          Obsidian 設定ファイル (プラグイン登録・テーマ設定)
  samples/            E2E テスト用サンプルファイル
```

## フィクスチャ更新ルール

### `.obsidian/community-plugins.json`
`["obsidian-drawio"]` を含む必要があります。`manifest.json` の `id` を変更した場合はここも更新してください。

### `.obsidian/app.json`
現在は空オブジェクト `{}` で配置しています。Obsidian が初回起動時に trust ダイアログを表示する場合、E2E setup project (`tests/e2e-setup/`) 側でダイアログを突破する実装を追加してください。

### `samples/` のサンプルファイル
サンプルファイルのバイト列を変更すると、それを参照している E2E テストの期待値も合わせて更新が必要です。

| ファイル | 形式 | 再生成方法 |
|---|---|---|
| `empty.drawio` | 平文 mxfile XML | テキストエディタで直接編集可 |
| `compressed.drawio` | pako deflateRaw + base64 | `.tmp/task-1.4/gen-samples.mjs` を参照 |
| `sample.drawio.svg` | SVG + `content` 属性 (base64 mxfile) | `.tmp/task-1.4/gen-samples.mjs` を参照 |
| `sample.drawio.png` | PNG + tEXt mxfile チャンク | `.tmp/task-1.4/gen-samples.mjs` を参照 |

### `workspace.json`
`.gitignore` で除外済みです。Obsidian が実行時に書き出すファイルであり、コミットしないでください。
