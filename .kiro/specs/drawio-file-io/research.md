# Research & Design Decisions

---

## Summary

- **Feature**: `drawio-file-io`
- **Discovery Scope**: Complex Integration（既存の plugin-foundation / drawio-embed-bridge に統合する新機能）
- **Key Findings**:
  - pako (MIT) は deflate/inflate に必要。`pako.inflateRaw` / `pako.deflateRaw` を Base64 と組み合わせて使う
  - `png-chunks-extract` (MIT) は PNG をチャンク配列に分解し、`png-chunk-text` で `mxfile` キーの zTXt / tEXt チャンクを扱う
  - drawio embed の export フローは `DrawioOutboundExport { action:'export', format:'xmlpng'|'xmlsvg' }` を送信し、`DrawioInboundExport { event:'export', data: string }` で Base64 データを受け取る既存プロトコルを利用する
  - `.png` 拡張子は Obsidian 組み込みの image view と衝突するため `registerExtensions(['png'], 'drawio')` は全 PNG を乗っ取る。opt-in 方式（`openDrawioPng` 設定フラグ）が最善
  - `.drawio.svg` は Obsidian が `.svg` 拡張子として認識するため、`registerExtensions(['svg'], 'drawio')` は全 SVG を乗っ取る。同様に opt-in または file-open hook が必要

---

## Research Log

### PNG チャンク操作ライブラリの調査

- **Context**: PNG に埋め込まれた `mxfile` XML の抽出・書き込みに適切なライブラリを選定
- **Findings**:
  - `png-chunks-extract` (MIT): `Buffer` → `{ name, data }[]` の変換を行うシンプルなライブラリ
  - `png-chunk-text` (MIT): tEXt / zTXt チャンクのエンコード・デコードを行う
  - `png-chunks-encode` (MIT): チャンク配列を有効な PNG `Buffer` へ再エンコードする
  - drawio が書き出す PNG は `mxfile` キーの zTXt チャンクを持つことが多い（draw.io desktop 同様）
- **Implications**: これら 3 ライブラリを組み合わせることで、既存の PNG バイナリを壊さずに `mxfile` チャンクを差し替えられる。drawio の `format:'xmlpng'` export 結果は既に mxfile チャンク埋め込み済みであるため、export 結果を直接書き込むのが最もシンプル

### pako 圧縮の判定方法

- **Context**: `.drawio` ファイルには平文 XML と pako 圧縮 Base64 の両方が存在する
- **Findings**:
  - 平文 XML は `<mxfile` または `<mxGraphModel` で始まる
  - pako 圧縮版は `<mxfile>` 内の `<diagram>` 要素の text content が Base64 文字列（`<`, `>` を含まない）
  - drawio が生成する圧縮形式は **`deflateRaw`** (zlib header なし)。`pako.inflateRaw(atob(base64str))` → XML string という変換が標準
  - 古い drawio や一部 fork は `deflate` (zlib header `0x78 0x9C` 等付き) を生成することがある。最初のバイトを覗き、zlib header が見えたら `pako.inflate` にフォールバックする
  - 復元結果は URL エンコードされている場合がある (drawio の歴史的形式)。`decodeURIComponent` を 1 度試みて失敗したらそのまま返す
- **Implications**: 読み込み時に `<mxfile` で始まるか確認し、`<diagram>` 内容が Base64 なら inflate する二段階判定が必要。`preserveCompression` フラグを読み込み時に記録し保存時に再現する。書き込みは drawio と同じ `deflateRaw` で統一する（ファイルが元 `deflate` でも `deflateRaw` で書き戻して問題なし、drawio は両方読める）

### `.drawio.svg` の拡張子登録問題

- **Context**: Obsidian は `.svg` 拡張子で登録すると全 SVG を drawio で開いてしまう
- **Findings**:
  - Brief 案 A: `.drawio` のみ registerExtensions → `.drawio.svg` は Obsidian の拡張子認識（last segment）により `.svg` として扱われるため、file-open hook が必要
  - Brief 案 B: `vault.on('file-open')` で `.drawio.svg` / `.drawio.png` を検出して openLinkText でリダイレクト
  - Brief 案 C: opt-in 設定
- **Selected**: 案 C をデフォルトとして採用。`openDrawioSvg` (default: true) / `openDrawioPng` (default: true) フラグを PluginSettings に追加し、有効な場合は `file-open` hook でリダイレクト。`.drawio` は `registerExtensions` で確実に登録

### drawio export フロー（SVG / PNG）

- **Context**: 保存時に drawio から SVG / PNG バイナリを取得する方法
- **Findings**:
  - `DrawioOutboundExport { action:'export', format:'xmlsvg'|'xmlpng' }` を postMessage で送信
  - drawio は `DrawioInboundExport { event:'export', data: string, format: string }` で応答する（data は Base64）
  - `DrawioBridge.requestExport(format)` が既に実装済み（drawio-embed-bridge spec）
  - `DrawioBridgeCallbacks.onExport(data, format)` で受け取ったデータを Base64 デコードして Vault に書き込む
- **Implications**: SaveHandler は export コールバックを 1 回だけ待機する Promise を内部で持ち、解決後に Vault.modify / modifyBinary を呼ぶ設計が明快

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 案 A: registerExtensions のみ | `.drawio` のみ登録、`.drawio.svg/.png` は無視 | シンプル | SVG/PNG ファイルの drawio 起動不可 | 採用しない |
| 案 B: file-open hook | `vault.on('file-open')` で全ファイル検出 | 完全制御 | 遅延が出る可能性、hook 実装コスト | 部分採用（SVG/PNG のみ） |
| 案 C: opt-in 設定 + file-open hook | 設定フラグ + hook | 非 drawio 画像と共存可能 | 設定 UI が必要（本 spec は最小フラグのみ） | **採用** |

---

## Design Decisions

### Decision: 保存フローで export を経由する（SVG/PNG）

- **Context**: SVG/PNG の保存は draw.io が生成したバイナリが必要（mxfile メタデータ込み）
- **Alternatives Considered**:
  1. 手動で SVG/PNG を生成し mxfile チャンクを埋め込む
  2. draw.io の export イベントを利用する
- **Selected Approach**: `DrawioBridge.requestExport` でフォーマット指定 → `onExport` コールバックで受け取り → Vault 書き込み
- **Rationale**: draw.io が生成した正規バイナリを使えば画像互換性が保証される。手動生成は SVG/PNG 仕様の再実装になりリスクが高い
- **Trade-offs**: 保存完了まで round-trip が必要（latency +数十 ms）
- **Follow-up**: export タイムアウト処理が必要（drawio が応答しない場合）

### Decision: `.drawio` の圧縮形式を read 時に判定し保存時に維持する

- **Context**: drawio は圧縮・非圧縮どちらの形式でも保存する。ユーザのワークフローを壊さない
- **Selected Approach**: `readDrawioFile` が `compressed: boolean` を返し、`writeDrawioFile` がそのフラグを参照する
- **Rationale**: ユーザが既に圧縮ファイルを使っている場合、非圧縮に変換するとサイズが変わりコミット diff が汚くなる
- **Trade-offs**: `preserveCompression` を PluginSettings として上書き可能にする（将来の settings spec へ委譲）

---

## Risks & Mitigations

- `png-chunks-extract` が Node.js `Buffer` を要求する場合 — Electron renderer で `Buffer` は利用可能なため問題ない
- drawio export タイムアウト — Promise に 10 秒タイムアウトを設け、失敗時は Notice 表示 + error log
- `.drawio.svg` のファイル名が `.svg` 拡張子として Obsidian に認識される — file-open hook で対応、opt-in フラグで制御
- Vault.modifyBinary に string を渡す誤り — TypeScript の `ArrayBuffer` 型で静的に防ぐ

---

## License Compatibility (Requirement 7.5)

| Package | License | Plugin License | Compatible | Notes |
|---|---|---|---|---|
| `pako` | MIT | (this plugin's distribution license) | Yes | MIT is permissive; bundled into `dist/main.js` as a runtime dependency, attribution required in distribution credits if Apache-2.0 is chosen |
| `png-chunks-extract` | MIT | same | Yes | bundled |
| `png-chunks-encode` | MIT | same | Yes | bundled |
| `png-chunk-text` | MIT | same | Yes | bundled |
| `@types/pako` | MIT | same | Yes | devDependency only, not bundled |

- All four runtime dependencies are MIT, which is compatible with both Apache-2.0 and MIT distribution licenses for this plugin.
- The plugin's `package.json` shall keep its existing license field unchanged; this spec does not introduce a license change.
- Attribution: each package's LICENSE file ships inside `node_modules/`; for Obsidian community plugin distribution, the bundle ships only `main.js` so attribution is satisfied via `package.json` metadata.

## Required Upstream Change (drawio-embed-bridge)

- `DrawioOutboundExport.format` and `DrawioBridge.requestExport` parameter must be extended to include `'xmlpng' | 'xmlsvg'`. These are the standard drawio embed export formats that include the editable mxfile XML inside the rendered binary, and are required for round-trip-safe save of `.drawio.svg` / `.drawio.png` files.
- Change is purely additive (union extension), no behavioural change to existing members → safe with bridge spec's revalidation triggers.

## References

- [draw.io embed postMessage プロトコル (drawio-embed-bridge design.md)](../drawio-embed-bridge/design.md)
- [pako npm (MIT)](https://www.npmjs.com/package/pako)
- [png-chunks-extract npm (MIT)](https://www.npmjs.com/package/png-chunks-extract)
- [png-chunks-encode npm (MIT)](https://www.npmjs.com/package/png-chunks-encode)
- [png-chunk-text npm (MIT)](https://www.npmjs.com/package/png-chunk-text)
- [Obsidian Plugin API: FileView](https://docs.obsidian.md/Reference/TypeScript+API/FileView)
