# Brief: drawio-settings-and-config

## Problem

drawio の embed mode は URL パラメータと postMessage で振る舞いを大きく変えられる (テーマ、UI の有無、shape libraries の選択、defaultLibraries、言語、math 表示など)。これらをユーザが Obsidian の設定 UI から GUI で操作でき、かつ「特定の図ファイルだけ別のアイコンセットを使う」など **per-diagram の上書き** も保存できる必要がある。現状はこの設定レイヤがまったく存在しない。

## Current State

- plugin-foundation 段階の `PluginSettings` 型は空 (もしくは最小限)
- `PluginSettingTab` 未実装
- drawio-embed-bridge の `DrawioBridge` は `setTheme` / `setLibraries` 等の API を **呼べる前提** で実装されているが、誰もそれを呼んでいない
- per-diagram 設定 (iconset 読み込みなど) を保存する場所が決まっていない (mxfile 属性 / sidecar JSON / frontmatter のいずれか)
- Obsidian テーマ (light/dark) と drawio 内テーマが連動しない

## Desired Outcome

- Settings タブで以下を GUI から設定できる:
  - **Theme**: `auto` (Obsidian に追従) / `light` / `dark` / `kennedy` / `min` / `atlas` (drawio 標準)
  - **Default libraries**: チェックボックス群 (general, basic, arrows, flowchart, ...)
  - **Custom libraries**: ファイルパス or URL のリスト (今回はローカルファイルのみ)
  - **Default save format**: 開いた拡張子を維持 (推奨) / 強制的に `.drawio` 化 など
  - **Compression**: `.drawio` 保存時に pako 圧縮するか
  - **Math typesetting**: drawio の MathJax を有効化するか
  - **Language**: drawio UI の言語 (Obsidian の locale に追従、または手動指定)
  - **Grid / page settings**: 既定値
  - **Diagram editor experience**: ribbon / command 登録の有効化、新規図ファイル作成のテンプレート
- Obsidian テーマが切り替わると (`workspace.on('css-change')`) drawio iframe にも postMessage で `theme` 更新が伝播する
- 各図ファイルごとに「このファイルではこの追加 iconset を使う」等の上書きが保存・復元される
  - 案 A (推奨): mxfile XML に `<mxfile customData="...">` または独自要素として埋め込む (drawio の round-trip で保持される)
  - 案 B: sidecar `<filename>.drawio.json` を Vault 内に並置
  - 案 C: Obsidian frontmatter — `.drawio` は Markdown ではないため対象外
  - 実装スパイクで A の round-trip 安全性を確認、ダメなら B にフォールバック

## Approach

- `src/lib/settings.ts` に `PluginSettings` 型を拡張 (上記項目すべて optional + default)
- `src/views/SettingsTab.tsx` に React コンポーネントとして UI を実装
  - `PluginSettingTab` の `display(containerEl)` で `createRoot(containerEl)` + `render(<SettingsApp />)`、`hide()` で `unmount()`
  - Obsidian の組み込み `Setting` API のスタイルに合わせるため CSS variables (`--background-primary` 等) を使用
- `src/lib/theme.ts` を拡張: `subscribeTheme(callback)` で `css-change` を購読、callback には `'light' | 'dark'` を渡す
- `DrawioView` 側で:
  - mount 時に現在の global 設定 + per-diagram 設定をマージして `bridge.mount(opts)` に渡す
  - `subscribeTheme` で iframe にテーマ更新を flush
  - per-diagram 設定の読み込み: 案 A の場合は drawio から取得した XML をパースして customData を抽出、保存時に注入
- per-diagram 設定 UI:
  - drawio webapp 側のメニューには手を入れない (upstream 改造禁止)
  - Obsidian 側の command "Edit per-diagram settings" を提供し、modal で React フォームを表示

## Scope

- **In**:
  - `PluginSettings` 型と DEFAULT_SETTINGS の拡張
  - React 製 `SettingsTab` (グローバル設定)
  - per-diagram 設定の永続化 (案 A 優先、案 B フォールバック)
  - per-diagram 設定の編集 modal
  - Obsidian テーマ追従 (`css-change` → `bridge.setTheme`)
  - 言語 / locale 追従 (Obsidian の `moment.locale()` 参照)
  - 設定マイグレーション (将来の version up に備えた `settingsVersion` フィールド)
- **Out**:
  - drawio webapp 側のメニュー改造
  - `.drawio.png` / `.drawio.svg` のメタデータ仕様 (drawio-file-io 担当)
  - `DrawioBridge` の API 自体の追加 (本 spec は **既存 API を呼ぶだけ**。追加が必要な場合は drawio-embed-bridge へ差し戻し)
  - クラウド連携 / 同期

## Boundary Candidates

- **Schema 層**: `src/lib/settings.ts` (型 + DEFAULT + load/save)
- **Global UI 層**: `src/views/SettingsTab.tsx`
- **Per-diagram UI 層**: `src/views/DiagramSettingsModal.tsx`
- **Persistence 層 (per-diagram)**: `src/lib/per-diagram-config.ts` (案 A or B)
- **Theme bridge 層**: `src/lib/theme.ts` の subscribe + `DrawioView` から `bridge.setTheme` への配線

## Out of Boundary

- ファイルフォーマットの reader/writer 自体
- iframe / postMessage プロトコルの追加 (必要な API は drawio-embed-bridge spec で先に追加してもらう)
- mxfile の構造仕様策定 (drawio-file-io が形式責任を持つ)
- Marketplace 申請 / リリース運用

## Upstream / Downstream

- **Upstream**:
  - plugin-foundation (`PluginSettings` / loadData / saveData / `theme.ts`)
  - drawio-embed-bridge (`DrawioBridge` API)
  - drawio-file-io (`DrawioView` / 3 形式 reader-writer に per-diagram 設定差し込みポイントを追加)
- **Downstream**: なし (現時点で本 spec が末端)

## Existing Spec Touchpoints

- **Extends**: drawio-file-io (`DrawioView` に per-diagram 設定の差し込み)、plugin-foundation (`PluginSettings` 拡張)
- **Adjacent**: drawio-embed-bridge (テーマ / library 用の bridge API がここで初めて消費される)

## Constraints

- **No external network**: 言語パックや shape library は同梱のみ。外部 URL からの fetch 禁止 (Submission requirements)
- **innerHTML 禁止**: React 経由で render するので守りやすいが、`dangerouslySetInnerHTML` は使用禁止
- **Per-diagram persistence 互換性**: 案 A を選ぶ場合、drawio webapp が round-trip で customData を保持することを E2E で検証。失われるなら案 B (sidecar) に切替
- **Migration**: 設定スキーマの破壊変更を避ける。`settingsVersion` で migration を識別可能にする
- **Theme**: `auto` モードでは Obsidian の現在テーマに即追従。`light`/`dark` 等の固定モードでは Obsidian テーマと不一致でも上書きしない (ユーザの意図優先)
- **Locale**: drawio が対応する言語コードに正規化 (例: Obsidian `ja` → drawio `ja`)。未対応なら `en` フォールバック
- **Cleanup**: SettingsTab の React root は `hide()` で必ず unmount する (Submission requirements の memory leak 対策)
