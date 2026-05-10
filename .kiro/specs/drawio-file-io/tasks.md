# Implementation Plan

- [ ] 0. drawio-embed-bridge の format union 拡張（upstream coordination）
- [x] 0.1 `DrawioOutboundExport.format` と `DrawioBridge.requestExport` の format パラメータを `'png' | 'svg' | 'xml' | 'pdf' | 'xmlpng' | 'xmlsvg'` に拡張する
  - 対象ファイル: `src/lib/drawio-protocol.ts`, `src/lib/drawio-bridge.ts` (drawio-embed-bridge spec の所有領域)
  - 既存 union メンバの挙動は変更しない（純粋に additive）
  - drawio-embed-bridge の単体テスト / 型チェックがすべて通ることを確認する
  - 本変更が完了するまで本 spec の Task 5.2 はブロックされる
  - _Requirements: 8.1, 8.2, 8.3_
  - _Boundary: drawio-embed-bridge.DrawioBridge, drawio-embed-bridge.DrawioOutboundExport_

- [ ] 1. 依存パッケージの追加とビルド設定
- [x] 1.1 npm 依存パッケージを追加する
  - `pako`, `png-chunks-extract`, `png-chunks-encode`, `png-chunk-text` を `dependencies` に追加する
  - `@types/pako` を `devDependencies` に追加する
  - `pnpm install` を実行してロックファイルを更新する
  - `pnpm build` が成功し `dist/main.js` に pako が bundle されていることを確認する（`require('pako')` が含まれないこと）
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - _Boundary: package.json_

- [ ] 2. PluginSettings への設定フィールド追加 (legacy トップレベル; settings spec が drawio 名前空間に吸収)
- [x] 2.1 設定型と初期値を追加する
  - `src/lib/settings.ts` で `plugin-foundation` が空 interface で公開する `PluginSettings` を declaration merging (`declare module './settings' { interface PluginSettings { ... } }`) で **legacy トップレベル**として `openDrawioSvg: boolean`, `openDrawioPng: boolean`, `preserveCompression: boolean` を追加する。`[key: string]: unknown` のような index signature は導入しない
  - `DEFAULT_SETTINGS` (plugin-foundation 由来) に `Object.assign(DEFAULT_SETTINGS, { openDrawioSvg: true, openDrawioPng: true, preserveCompression: true })` でデフォルト値をマージする
  - 注: `drawio-settings-and-config` spec の `migrateSettings` が legacy フィールドを `drawio.openDrawioSvg` / `drawio.openDrawioPng` / `drawio.compression` 名前空間に移動させる責務を持つ。本 spec の DrawioView / main.ts は読み取り側で `settings.drawio.openDrawioSvg` / `settings.drawio.openDrawioPng` / `settings.drawio.compression` を参照すること (settings spec 適用後は legacy トップレベルは raw data から消去される)
  - TypeScript 型チェックが通ることを確認する
  - _Requirements: 1.4, 3.1, 3.2_
  - _Boundary: SettingsModule_

- [ ] 3. Format ライブラリの実装（3 形式 reader/writer）
- [x] 3.1 (P) `.drawio` XML reader/writer を実装する
  - `src/lib/drawio-formats/drawio-xml.ts` を作成する
  - `readDrawioXml(content: string): { xml: string; compressed: boolean }` を実装する: 平文 XML（`<mxfile`または`<mxGraphModel`で始まる）はそのまま返し、`<diagram>` 内容が Base64 文字列なら `pako.inflateRaw` + TextDecoder で XML を復元する
  - `writeDrawioXml(xml: string, compressed: boolean): string` を実装する: `compressed: true` の場合は TextEncoder → `pako.deflateRaw` → `btoa` → `<mxfile><diagram>...</diagram></mxfile>` に包む
  - 平文・圧縮・未知形式の 3 パターンで動作することを単体テスト相当のコードで確認する
  - _Requirements: 2.1, 2.2, 2.7, 3.1, 3.2_
  - _Boundary: DrawioXml_

- [x] 3.2 (P) `.drawio.svg` SVG reader を実装する
  - `src/lib/drawio-formats/drawio-svg.ts` を作成する
  - `readDrawioSvg(svgContent: string): string` を実装する: DOMParser で解析し、`<svg content="...">` 属性を `atob` して XML を取得; なければ `svg.querySelector('mxfile')?.textContent` を試みる; 両方失敗時は `'<mxGraphModel/>'` を返して `console.warn` を出力する
  - `content` 属性あり・`<mxfile>` 子要素あり・両方なしの 3 パターンで正しい XML が返ることを確認する
  - _Requirements: 2.3, 2.4, 2.7, 3.3_
  - _Boundary: DrawioSvg_

- [x] 3.3 (P) `.drawio.png` PNG reader/writer を実装する
  - `src/lib/drawio-formats/drawio-png.ts` を作成する
  - `readDrawioPng(buffer: ArrayBuffer): string` を実装する: `pngChunksExtract(new Uint8Array(buffer))` → チャンク配列を走査し `name === 'zTXt' || name === 'tEXt'` かつ `pngChunkText.decode(data).keyword === 'mxfile'` のチャンクの `text` を返す; 見つからない場合は `'<mxGraphModel/>'` を返して `console.warn` を出力する
  - `writeDrawioPngWithMxfile(existingPng: ArrayBuffer, newMxfileXml: string): ArrayBuffer` を実装する: 既存チャンクを取得 → 既存 `mxfile` チャンクがあれば置換、無ければ IEND の直前に挿入 → 他のチャンク (IHDR / IDAT / IEND / pHYs / sRGB 等) は byte-for-byte 維持 → `pngChunksEncode` で再エンコードして `ArrayBuffer` を返す
  - `mxfile` zTXt チャンクを持つ PNG バッファからの XML 抽出が成功すること、writer が IHDR/IDAT/IEND を破壊せず `mxfile` チャンクのみ差し替えることを確認する
  - _Requirements: 2.5, 2.7, 5.3, 6.1, 6.2, 6.3_
  - _Boundary: DrawioPng_

- [x] 3.5 (P) `.drawio.svg` writer (writeDrawioSvgWithMxfile) を実装する
  - `src/lib/drawio-formats/drawio-svg.ts` に追加する
  - `writeDrawioSvgWithMxfile(existingSvg: string, newMxfileXml: string): string` を実装する: DOMParser で SVG を解析 → `content` 属性があれば `btoa(newMxfileXml)` で更新; なければ既存 `<mxfile>` 子要素を置換; どちらも無ければ `<svg>` 直下に新規 `<mxfile>` を追加 → `XMLSerializer` で出力。`<style>`, `<defs>`, 他の attribute は破壊しないこと
  - 既存 `<style>` を含む SVG に対し、style 要素が保持されたまま mxfile だけ置換されることを確認する
  - _Requirements: 5.3, 6.1, 6.4_
  - _Boundary: DrawioSvg_

- [x] 3.4 Format index の公開 API を実装する
  - `src/lib/drawio-formats/index.ts` を作成する
  - `DrawioFormat`, `ReadDrawioResult`, `WriteDrawioOptions`, `WriteDrawioPayload` (discriminated union: `{kind:'xml',xml}` | `{kind:'svg',exportedSvg}` | `{kind:'png',exportedPng:ArrayBuffer}`) 型を定義する
  - `readDrawioFile(file: TFile, vault: Vault): Promise<ReadDrawioResult>` を実装する: ファイル名末尾で `'.drawio.svg'` / `'.drawio.png'` / `'.drawio'` を判定し対応 reader を呼ぶ; 失敗時は fallback `{ xml: '<mxGraphModel/>', format: 'drawio', compressed: false }` を返して `console.warn` を出力する
  - `writeDrawioFile(file, vault, payload, format, options?)` を実装する: `payload.kind` と `format` の整合をランタイムで検証 → `'drawio'` は `writeDrawioXml` の結果を `Vault.modify`、`'drawio-svg'` は `payload.exportedSvg` を `Vault.modify`、`'drawio-png'` は `payload.exportedPng` (ArrayBuffer) を `Vault.modifyBinary` に渡す（string 変換禁止）
  - `readDrawioXml`, `writeDrawioXml`, `readDrawioSvg`, `writeDrawioSvgWithMxfile`, `readDrawioPng`, `writeDrawioPngWithMxfile` を index から re-export する
  - 3 形式それぞれで `readDrawioFile` が `ReadDrawioResult` を返すことを確認する
  - _Depends: 3.1, 3.2, 3.3, 3.5_
  - _Requirements: 2.6, 3.7, 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Boundary: FormatIndex_

- [ ] 4. DrawioView の実装
- [x] 4.1 DrawioView クラスの基本構造を実装する
  - `src/views/DrawioView.ts` を作成する
  - `DRAWIO_VIEW_TYPE = 'drawio'` を export する
  - `FileView` を継承した `DrawioView` クラスを実装する: `getViewType()`, `getDisplayText()`, `onLoadFile(file)`, `onUnloadFile(file)` を実装する
  - `onLoadFile` で `readDrawioFile(file, this.app.vault)` を呼び、`createDrawioBridge(this.app)` を使って `DrawioBridge.mount(container, { initialXml: xml })` を実行する
  - Obsidian でビューが登録後にファイルをクリックして空の iframe が表示されることを確認する
  - _Depends: 3.4_
  - _Requirements: 1.1, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - _Boundary: DrawioView_

- [x] 4.2 dirty フラグ・getCurrentXml・reload API を実装する
  - `DrawioView` に `private _isDirty = false` と `private _lastXml: string | null = null` を追加し、`get isDirty(): boolean` getter / `getCurrentXml(): string | null` を実装する
  - `DrawioBridgeCallbacks.onAutosave` / `onSave` 受信時に `_lastXml = xml` を更新し `_isDirty = true` にセットする
  - `DrawioDirtyReloadError extends Error` クラスを export する（`name='DrawioDirtyReloadError'`）
  - `async reload(file: TFile, options?: { force?: boolean }): Promise<void>` を実装する: `_isDirty === true && !options?.force` なら `DrawioDirtyReloadError` を reject; それ以外は `readDrawioFile` → `DrawioBridge.load(xml)` → `currentFormat` / `currentCompressed` を更新し `_isDirty = false` `_lastXml = xml` をセット
  - `onUnloadFile` / `onClose` で `DrawioBridge.dispose()` を呼び `_isDirty = false` `_lastXml = null` にリセットする
  - `isDirty` が autosave 後に `true`、reload 成功後に `false` になること、dirty 時の `reload({force:false})` が `DrawioDirtyReloadError` を投げることを確認する
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: DrawioView_

- [ ] 5. 保存ハンドラの実装（3 形式対応）
- [x] 5.1 `.drawio` ファイルの保存ハンドラを実装する
  - `DrawioView` の `onSave(xml)` / `onAutosave(xml)` コールバックで `currentFormat === 'drawio'` の場合に `writeDrawioFile(file, vault, {kind:'xml', xml}, 'drawio', { compressed: this.currentCompressed })` を呼ぶ
  - 成功時に `_isDirty = false` にセットし、失敗時に `console.error` と `new Notice(...)` を呼んで `_isDirty = true` を維持する
  - `.drawio` ファイルを編集後保存すると Vault のファイルが更新され、元が圧縮形式なら圧縮形式のまま書き戻ることを確認する
  - _Depends: 4.2_
  - _Requirements: 3.1, 3.2, 3.5, 3.6_
  - _Boundary: DrawioView_

- [x] 5.2 SVG / PNG の export 経由保存ハンドラを実装する
  - `DrawioView` の `onSave(xml)` / `onAutosave(xml)` コールバックで `currentFormat === 'drawio-svg'` の場合は `bridge.requestExport('xmlsvg')`、`'drawio-png'` の場合は `bridge.requestExport('xmlpng')` を呼ぶ
  - `onExport(data, format)` コールバック内で format が `'xmlsvg'` / `'xmlpng'` であることを検証 (期待外は無視 + log) → `atob(data)` → `Uint8Array.buffer` を構築し、`writeDrawioFile` 経由で SVG は `{kind:'svg', exportedSvg: utf8Decoded}` (Vault.modify)、PNG は `{kind:'png', exportedPng: arrayBuffer}` (Vault.modifyBinary) で書き込む
  - export タイムアウト（10 秒）を `Promise.race` で実装し、タイムアウト時は `new Notice('drawio export timed out')` を表示して `isDirty = true` を維持する
  - `.drawio.svg` / `.drawio.png` を編集後保存すると、ファイルが画像として `<img>` で表示でき、Markdown `![[...]]` 埋め込みでもプレビューできることを確認する
  - _Depends: 0.1, 4.2_
  - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 8.2_
  - _Boundary: DrawioView_

- [ ] 6. Plugin への View 登録と拡張子ルーティング
- [x] 6.1 registerView と registerExtensions を Plugin に追加する
  - `src/main.ts` の `onload()` に `this.registerView(DRAWIO_VIEW_TYPE, leaf => new DrawioView(leaf, this))` を追加する
  - `this.registerExtensions(['drawio'], DRAWIO_VIEW_TYPE)` を追加する
  - `.drawio` ファイルをクリックすると drawio ビューが開くことを Obsidian Desktop で確認する
  - _Depends: 4.1_
  - _Requirements: 1.1, 1.2, 1.5_
  - _Boundary: ObsidianDrawioPlugin_

- [x] 6.2 `.drawio.svg` / `.drawio.png` のファイルオープン hook を追加する
  - `this.registerEvent(this.app.workspace.on('file-open', ...))` で開かれたファイルの末尾を判定する
  - `settings.drawio.openDrawioSvg === true` かつ `file.name.endsWith('.drawio.svg')` の場合は `leaf.setViewState({ type: DRAWIO_VIEW_TYPE, state: { file: file.path } })` でビューを切り替える
  - `settings.drawio.openDrawioPng === true` かつ `file.name.endsWith('.drawio.png')` の場合も同様に切り替える
  - `.drawio.svg` / `.drawio.png` をクリックすると drawio ビューが開くことを確認する
  - `settings.drawio.openDrawioPng: false` の場合は `.drawio.png` が組み込み image view で開くことを確認する
  - _Depends: 4.1_
  - _Requirements: 1.3, 1.4, 1.5_
  - _Boundary: ObsidianDrawioPlugin_

- [ ] 7. 統合テストと検証
- [x] 7.1 3 形式のエンドツーエンド往復を検証する
  - 各形式のサンプルファイル（`.drawio`・`.drawio.svg`・`.drawio.png`）を Vault に配置してクリックし、drawio ビューが開いて図形が表示されることを確認する
  - 図形を編集して保存し、ファイルを再オープンしたときに変更が維持されていることを確認する
  - 保存後の `.drawio.svg` / `.drawio.png` を Markdown の `![[...]]` 埋め込みで表示できることを確認する
  - _Depends: 5.1, 5.2, 6.1, 6.2_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 6.1, 6.2, 6.3_
  - _Boundary: DrawioView, FormatIndex_

- [ ]* 7.2 単体テストを追加する（任意）
  - `drawio-xml.ts` の `readDrawioXml` / `writeDrawioXml` に対する Vitest または手動スクリプトを追加する: 平文・`deflateRaw` 圧縮・`deflate` (zlib header) フォールバック・round-trip の各ケース
  - `drawio-svg.ts` の `readDrawioSvg` / `writeDrawioSvgWithMxfile` に対するテストを追加する: content 属性・mxfile 子要素・両方なし、`<style>`/`<defs>` 保持の検証
  - `drawio-png.ts` の `readDrawioPng` / `writeDrawioPngWithMxfile` に対するテストを追加する: zTXt チャンクあり・なし、IHDR/IDAT/IEND/pHYs を byte-for-byte 比較
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 5.3, 6.3, 6.4_
  - _Boundary: DrawioXml, DrawioSvg, DrawioPng_
