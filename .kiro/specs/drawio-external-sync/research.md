# 調査ログ: drawio-external-sync

## 調査スコープ

`drawio-external-sync` 仕様策定のために実施した調査のまとめ。主にアップストリーム spec のインターフェース確認と外部変更検知の設計パターンに関する調査を行った。

---

## アップストリーム spec インターフェース確認

### plugin-foundation

- `ObsidianDrawioPlugin extends Plugin` — `onload()` / `onunload()` ライフサイクル
- `PluginSettings` — `[key: string]: unknown` + 後続 spec がフィールドを追加するパターン
- `ReactMountManager.mount(container, component): Root` / `unmount(container)` / `unmountAll()`
- `plugin.events` — Obsidian の `Events` クラスインスタンス。`trigger` / `on` / `off` が使用可能

### drawio-embed-bridge

- `DrawioBridge.load(xml: string): void` — 外部からの XML 再投入に使用
- `DrawioBridge.requestExport(format: 'xml' | ...)` → `onExport(data, format)` コールバック — 現在 iframe 内 XML 取得に使用
- `DrawioBridge.isMounted: boolean` — 安全確認に使用

### drawio-file-io

- `DrawioView.isDirty: boolean` — 衝突判定に使用
- `DrawioView.reload(file: TFile): Promise<void>` — 強制リロードに使用
- `readDrawioFile(file, vault): Promise<{ xml, format, compressed }>` — Public API / 自動リロードに使用
- `writeDrawioFile(file, vault, xml, format, options?)` — Keep mine / Public API に使用

### drawio-settings-and-config

- `DrawioSettings` に `externalSync: ExternalSyncSettings` を追加する方式を採用
- `<section data-spec="external-sync">` の予約方式は drawio-settings-and-config の `SettingsTab.tsx` 設計と整合する
- `migrateSettings` にバージョン分岐を追加してデフォルト値補完する

---

## 設計決定

### Echo 抑制方式

**決定**: `registerSelfWrite(path)` + `recentSelfWrites: Map<string, number>` (path → timestamp) で `echoSuppressionMs` (既定 300ms) 以内のイベントを無視する

**理由**: プラグイン自身の `writeDrawioFile` が Vault の modify イベントを再び発火することへの対策。simple な Map で十分で、ファイルパスが key なので衝突なし。ExternalWatcher を介した書き込みは `registerSelfWrite` を呼ばないため、API 経由の意図的な書き込みは通知を受け取れる設計にする。

### Event Bus 方式

**決定**: `plugin.events` (Obsidian の `Events` クラス) を使用し `'drawio:external-change'` イベントを trigger する

**理由**: Obsidian の標準 Events クラスは `onunload()` 時の自動解除には対応しないため、DrawioView 側で手動解除が必要。ただし Obsidian の内蔵機能であり追加ライブラリ不要。Custom EventTarget や mitt よりシンプル。

### diff 表示方式

**決定**: `@codemirror/merge` の遅延 import を試みてフォールバックする

**理由**: vite.config.ts で `@codemirror/*` は external 扱いのため、Obsidian の組み込み CodeMirror 6 環境を利用できる。利用不可の場合は行単位の簡易 diff にデグレードする。

### Public API 公開方式

**決定**: `ObsidianDrawioPlugin` のプロパティとして `this.api = createDrawioPluginApi(...)` を設定し、`app.plugins.plugins['<id>'].api` でアクセスさせる

**理由**: Obsidian コミュニティプラグインの標準慣習。型安全に `DrawioPublicApi` インターフェースを export し、consumers は型キャストで利用できる。
