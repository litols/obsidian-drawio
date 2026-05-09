# Requirements Document

## Introduction

`drawio-file-io` は Obsidian Vault 内の `.drawio` / `.drawio.svg` / `.drawio.png` ファイルを draw.io エディタで開き、編集・保存できる FileView を提供する。3 形式それぞれのメタデータ埋め込み構造（XML 圧縮判定 / SVG `content` 属性または `<mxfile>` 子要素 / PNG zTXt `mxfile` チャンク）を適切に読み書きし、Vault I/O を通じて元の形式のまま書き戻す。`plugin-foundation` の `ObsidianDrawioPlugin` と `drawio-embed-bridge` の `DrawioBridge` に依存し、外部変更検知（`drawio-external-sync`）向けに `dirty` フラグと `reload` API を公開する。

## Boundary Context

- **In scope**:
  - `DrawioView` (`FileView` サブクラス) の実装
  - 3 形式 (`.drawio` / `.drawio.svg` / `.drawio.png`) の reader / writer 純粋関数
  - `pako` / `png-chunks-extract` / `png-chunks-encode` / `png-chunk-text` 依存追加
  - `registerView` および `registerExtensions` (または代替経路) の確立
  - PNG / SVG が「画像としても」開ける invariants の維持
  - 保存時の形式維持（元が PNG → PNG、SVG → SVG、`.drawio` → XML）
  - drawio 側 `format:'xmlpng'` / `format:'xmlsvg'` の export request 経路
  - `PluginSettings` への `preserveCompression` フラグ追加

- **Out of scope**:
  - drawio webapp / iframe 自体の構築 — drawio-embed-bridge
  - 設定 UI / テーマ追従 — drawio-settings-and-config
  - per-diagram の view 設定永続化 — drawio-settings-and-config
  - `.vsdx` などの追加形式
  - 図のサムネイル生成
  - 外部変更検知ロジック本体 — drawio-external-sync

- **Adjacent expectations**:
  - `drawio-embed-bridge` の `DrawioBridge` は実装済みであり、`mount` / `dispose` / `load` / `requestExport` / `sendMessage` を提供すること
  - `plugin-foundation` の `ObsidianDrawioPlugin` は `registerView` を呼べる状態にあること
  - `drawio-external-sync` は本 spec が公開する `readDrawioFile` / `writeDrawioFile` 純粋関数と `DrawioView` の `isDirty` / `reload` を利用すること

## Requirements

### Requirement 1: DrawioView ファイルビュー登録

**Objective:** As an Obsidian desktop user, I want `.drawio` / `.drawio.svg` / `.drawio.png` files to open in the draw.io editor when clicked in the file tree, so that I can view and edit diagrams without leaving Obsidian.

#### Acceptance Criteria

1. When the plugin loads, the DrawioPlugin shall register a view of type `'drawio'` via `registerView`.
2. When the plugin loads, the DrawioPlugin shall register the `.drawio` extension via `registerExtensions(['drawio'], 'drawio')` so that `.drawio` files open with the drawio view.
3. When a `.drawio.svg` file is opened and `PluginSettings.drawio.openDrawioSvg` is `true`, the DrawioPlugin shall open it with the drawio view type instead of the built-in image view; when `drawio.openDrawioSvg` is `false`, the DrawioPlugin shall leave the file to the built-in SVG/image viewer. (Note: this spec adds `openDrawioSvg` to PluginSettings as a legacy top-level field; the `drawio-settings-and-config` spec's `migrateSettings` absorbs it into the `drawio.*` namespace, and consumers in this spec read `settings.drawio.openDrawioSvg` after migration.)
4. When a `.drawio.png` file is opened and `PluginSettings.drawio.openDrawioPng` is `true`, the DrawioPlugin shall open it with the drawio view type instead of the built-in image view; when `drawio.openDrawioPng` is `false`, the DrawioPlugin shall leave the file to the built-in image viewer so that non-drawio PNG files still open as images.
5. The DrawioPlugin shall NOT call `registerExtensions(['png'], ...)` or `registerExtensions(['svg'], ...)` so that ordinary `.png` / `.svg` files outside the `.drawio.*` naming convention remain bound to the built-in image view.
6. When the plugin unloads, the DrawioPlugin shall deregister the view and remove all extension associations and `file-open` listeners registered by this spec (relying on `registerView` / `registerExtensions` / `registerEvent` automatic cleanup).

### Requirement 2: ファイル読み込み（3 形式の XML 抽出）

**Objective:** As a draw.io diagram author, I want the plugin to correctly extract the diagram XML from all three file formats, so that the drawio editor receives the correct content regardless of the source file type.

#### Acceptance Criteria

1. When a `.drawio` file is opened and its content starts with `<mxfile` or `<mxGraphModel`, the DrawioPlugin shall pass the XML string directly to `DrawioBridge.load`.
2. When a `.drawio` file is opened and its content is Base64-encoded pako-compressed XML, the DrawioPlugin shall decompress the content using pako `inflate` and pass the resulting XML string to `DrawioBridge.load`.
3. When a `.drawio.svg` file is opened and the `<svg>` root element has a `content` attribute, the DrawioPlugin shall URL-decode (if needed) and/or Base64-decode the value and pass the resulting `<mxfile>` XML string to `DrawioBridge.load`.
4. When a `.drawio.svg` file is opened and the SVG does not have a `content` attribute but contains a `<mxfile>` child element (drawio's alternative embedding), the DrawioPlugin shall extract its serialized text content and pass the XML string to `DrawioBridge.load`.
5. When a `.drawio.png` file is opened, the DrawioPlugin shall read the file as `ArrayBuffer`, extract the chunk whose decoded text keyword equals `mxfile` from the `tEXt` or `zTXt` chunks using `png-chunks-extract` / `png-chunk-text`, and pass the decoded `<mxfile>` XML string to `DrawioBridge.load`.
6. If none of the extraction strategies yield a valid XML string, the DrawioPlugin shall load an empty diagram XML (`<mxGraphModel/>`) and log a warning to the console.
7. The DrawioPlugin shall record the source format (`'drawio' | 'drawio-svg' | 'drawio-png'`) and whether the original `.drawio` content was compressed (`preserveCompression`) for use during save.

### Requirement 3: ファイル保存（3 形式への書き戻し）

**Objective:** As a diagram editor, I want changes saved back to the original file in the original format with metadata intact, so that the file remains compatible with other tools.

#### Acceptance Criteria

1. When the draw.io editor emits a `save` event with XML for a `.drawio` file and `preserveCompression` is true, the DrawioPlugin shall re-compress the XML using pako `deflate`, Base64-encode it, and write the result to Vault via `Vault.modify`.
2. When the draw.io editor emits a `save` event with XML for a `.drawio` file and `preserveCompression` is false, the DrawioPlugin shall write the plain XML string to Vault via `Vault.modify`.
3. When the draw.io editor emits a `save` event for a `.drawio.svg` file, the DrawioPlugin shall request an export with `format: 'xmlsvg'` (mxfile-embedded SVG) from draw.io via `DrawioBridge.requestExport`, receive the SVG payload via `onExport`, decode it, and write it to Vault via `Vault.modify` as a UTF-8 string.
4. When the draw.io editor emits a `save` event for a `.drawio.png` file, the DrawioPlugin shall request an export with `format: 'xmlpng'` (mxfile-embedded PNG) from draw.io via `DrawioBridge.requestExport`, receive the Base64 PNG payload via `onExport`, decode it to an `ArrayBuffer`, and write it to Vault via `Vault.modifyBinary` using the `ArrayBuffer` directly without any string conversion.
5. When the draw.io editor emits an `autosave` event, the DrawioPlugin shall perform the same write-back procedure as a `save` event.
6. If `Vault.modify` or `Vault.modifyBinary` fails, the DrawioPlugin shall log the error to the console and display a Notice to the user.
7. The DrawioPlugin shall never convert binary PNG data through a string intermediate; `Vault.modifyBinary` shall receive an `ArrayBuffer` directly.

### Requirement 4: dirty フラグ・reload API・getCurrentXml hook

**Objective:** As the drawio-external-sync feature, I want to know whether a DrawioView has unsaved changes, retrieve its current XML, and reload it from disk, so that I can handle external file changes safely without losing user edits.

#### Acceptance Criteria

1. The DrawioPlugin shall expose a `isDirty` boolean getter on `DrawioView` that returns `true` after the draw.io editor emits any `autosave` or `save` event and is reset to `false` after a successful Vault write completes.
2. The DrawioPlugin shall expose `DrawioView.getCurrentXml(): string | null` returning the most recently observed `<mxfile>` XML from `onAutosave` / `onSave` (or the initially loaded XML if no edit event has fired yet); it returns `null` only before any file is loaded.
3. When `DrawioView.reload(file: TFile, options?: { force?: boolean }): Promise<void>` is called and `isDirty === false` (or `options.force === true`), the DrawioPlugin shall re-read the file via `readDrawioFile`, call `DrawioBridge.load(xml)`, refresh `currentFormat` / `currentCompressed`, and reset `_isDirty` to `false`.
4. When `DrawioView.reload` is called while `isDirty === true` and `options.force` is not `true`, the DrawioPlugin shall reject the returned `Promise` with an `Error` whose `name` is `'DrawioDirtyReloadError'`, leaving in-memory state unchanged so the caller (drawio-external-sync) can prompt the user.
5. The DrawioView shall expose `DRAWIO_VIEW_TYPE` as an exported constant string `'drawio'` so external specs can target it via `getViewState` / `setViewState`.

### Requirement 5: 純粋関数 API（外部利用可能な reader/writer）

**Objective:** As the drawio-external-sync feature (and future specs), I want format-specific pure functions for reading and writing drawio files that are independent of the view lifecycle, so that I can extract / inject mxfile XML outside a DrawioView context (e.g., when reconciling external edits without opening the editor).

#### Acceptance Criteria

1. The DrawioPlugin shall export a pure function `readDrawioFile(file: TFile, vault: Vault): Promise<ReadDrawioResult>` (where `ReadDrawioResult = { xml: string; format: DrawioFormat; compressed: boolean }`) that reads the file content and returns the extracted XML plus metadata.
2. The DrawioPlugin shall export a pure function `writeDrawioFile(file: TFile, vault: Vault, payload: WriteDrawioPayload, format: DrawioFormat, options?: WriteDrawioOptions): Promise<void>` that writes back to Vault in the correct format, where `payload` is `{ xml: string }` for `'drawio'` and `{ exportedSvg: string } | { exportedPng: ArrayBuffer }` for the other two formats; `Vault.modifyBinary` shall always receive an `ArrayBuffer` directly.
3. The DrawioPlugin shall additionally export the format-level pure helpers `readDrawioXml` / `writeDrawioXml` (string ↔ `{ xml, compressed }`), `readDrawioSvg` / `writeDrawioSvgWithMxfile` (string ↔ string, the latter taking an existing SVG and replacing only the `mxfile` payload — used by external-sync when injecting XML into an SVG without re-running drawio export), and `readDrawioPng` / `writeDrawioPngWithMxfile` (`ArrayBuffer` ↔ `ArrayBuffer`, replacing only the `mxfile` zTXt chunk and preserving every other chunk byte-for-byte).
4. None of the pure functions in 5.1–5.3 shall depend on `DrawioView`, `DrawioBridge`, the Obsidian `App` instance, or any DOM state outside what they parse from their string / ArrayBuffer inputs (DOMParser usage inside `drawio-svg.ts` is allowed since DOMParser is a Web standard available in Electron renderer).
5. If `readDrawioFile` encounters an unrecognized format or extraction failure, it shall return `{ xml: '<mxGraphModel/>', format: 'drawio', compressed: false }` and log a `console.warn` describing the file name and reason.

### Requirement 6: PNG / SVG の画像互換性と round-trip 整合性

**Objective:** As an Obsidian user, I want `.drawio.svg` and `.drawio.png` files to remain viewable as standard images (e.g., via `![[file.drawio.png]]` transclusion or the image preview) and to keep their non-mxfile content intact across edit cycles, so that my notes render correctly and metadata I added outside drawio is not silently dropped.

#### Acceptance Criteria

1. The DrawioPlugin shall ensure that the SVG bytes written by a `format: 'xmlsvg'` export start with a valid SVG root element, contain a parseable `<mxfile>` payload (either as `content` attribute or `<mxfile>` child), and render as an image in a standard `<img>` element.
2. The DrawioPlugin shall ensure that the PNG bytes written by a `format: 'xmlpng'` export contain a valid PNG signature, an IHDR chunk, at least one IDAT chunk, and an IEND chunk, in the order required by the PNG specification.
3. When `writeDrawioPngWithMxfile` is used (external-sync code path that does NOT round-trip through drawio's exporter), the DrawioPlugin shall preserve every non-`mxfile` chunk byte-for-byte (IHDR / IDAT / IEND / pHYs / sRGB / etc.) and only replace or insert the single `mxfile` `tEXt` / `zTXt` chunk; the IHDR shall remain the first chunk and IEND the last.
4. When `writeDrawioSvgWithMxfile` is used, the DrawioPlugin shall preserve all SVG attributes, child nodes, `<style>`, `<defs>`, and other metadata that are not the `mxfile` carrier (the `content` attribute on the `<svg>` root or a single top-level `<mxfile>` child), modifying only that carrier.
5. The DrawioPlugin shall verify in integration testing that a file edited and saved through the drawio view can subsequently be embedded via `![[file.drawio.png]]` / `![[file.drawio.svg]]` and rendered without errors in Obsidian's preview.

### Requirement 7: 依存パッケージの追加

**Objective:** As a plugin developer, I want the required npm packages installed so that format parsing works at runtime.

#### Acceptance Criteria

1. The DrawioPlugin shall declare `pako` as a production dependency in `package.json`.
2. The DrawioPlugin shall declare `png-chunks-extract`, `png-chunks-encode`, and `png-chunk-text` as production dependencies in `package.json`.
3. The DrawioPlugin shall declare `@types/pako` as a devDependency in `package.json`.
4. The DrawioPlugin build shall bundle `pako`, `png-chunks-extract`, `png-chunks-encode`, and `png-chunk-text` into `dist/main.js` (they are not external).
5. The DrawioPlugin shall confirm that each dependency's license (MIT for `pako` / `png-chunks-extract` / `png-chunks-encode` / `png-chunk-text`, plus `@types/pako` MIT) is compatible with the plugin's distribution license, and shall record the license decision in `research.md`.

### Requirement 8: drawio-embed-bridge protocol との整合 (upstream coordination)

**Objective:** As the implementer, I need the `DrawioBridge.requestExport` API to accept the mxfile-embedded export formats `'xmlpng'` and `'xmlsvg'`, so that the file-io view can request lossless drawio-generated binaries with embedded mxfile metadata.

#### Acceptance Criteria

1. Before implementation begins, the DrawioPlugin team shall extend `DrawioBridge.requestExport` and `DrawioOutboundExport.format` in `drawio-embed-bridge` to accept the union `'png' | 'svg' | 'xml' | 'pdf' | 'xmlpng' | 'xmlsvg'` (the latter two being the standard drawio embed export formats that include the mxfile XML inside the rendered binary).
2. The DrawioPlugin shall NOT bypass the bridge by directly calling `iframe.contentWindow.postMessage` from within `DrawioView`; all outbound messages shall go through `DrawioBridge.requestExport` / `DrawioBridge.sendMessage`.
3. If the upstream extension in 8.1 is not yet merged, this spec's tasks shall block on it (an explicit `_Depends:_` marker in `tasks.md` references the bridge change) rather than introducing a parallel postMessage path.
