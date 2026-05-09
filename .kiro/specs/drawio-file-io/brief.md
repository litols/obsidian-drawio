# Brief: drawio-file-io

## Problem

ユーザは Vault 内に既に存在する `.drawio` / `.drawio.svg` / `.drawio.png` ファイルを Obsidian でクリックして開き、その場で編集して保存したい。3 形式は画像ファイルとしての見た目を保ったままダブルクリック編集できる必要がある (drawio-desktop と同じ挙動)。`.png` は Obsidian の組み込み image view と衝突するため、優先度の解決と invariants 保持 (PNG/SVG が依然として画像として開ける、drawio で開くこともできる) が課題。

## Current State

- 3 形式の読み書きロジックなし
- `registerView` / `registerExtensions` 未呼び出し
- PNG/SVG に埋め込まれた `mxfile` XML を抽出する utility なし
- pako / png-chunks-extract 等の依存なし
- drawio-embed-bridge の `DrawioBridge` は存在するが Vault のファイルとは未接続

## Desired Outcome

- `.drawio` / `.drawio.svg` / `.drawio.png` を Obsidian のファイルツリーからクリックすると drawio エディタで開き、保存できる
- 3 形式すべてで往復可能:
  - `.drawio`: 平文 XML / pako 圧縮 XML を判定して読み、保存時は元の形式 (圧縮 or 平文) を維持 (preserveCompression: 既定 true)
  - `.drawio.svg`: SVG `content` 属性 (base64 mxfile) または `<mxfile>` 子要素から XML を抽出、保存時は drawio に SVG export させた結果を書き戻す (mxfile 埋め込み付き)
  - `.drawio.png`: PNG の zTXt/tEXt `mxfile` チャンクから XML 抽出、保存時は drawio に PNG export させた結果を書き戻す (mxfile チャンク埋め込み付き)
- 編集中に drawio から `autosave` / `save` イベントが来たら `Vault.modify` / `Vault.modifyBinary` で書き戻し
- PNG ファイルは依然として画像として preview / Markdown 内 `![[...]]` 埋め込みでも見えること (drawio がエクスポートした正規 PNG なので image としても valid)

## Approach

- `src/views/DrawioView.ts` に `FileView` サブクラスを実装
  - `getViewType()`: `'drawio'`
  - `onLoadFile(file)` で拡張子判定 → 適切な reader で XML 抽出 → `bridge.mount(container)` → `bridge.load(xml, originalFormat)`
  - drawio の `save` イベントを受け、`originalFormat` に応じて serializer を呼んで `Vault` に書き戻し
- `src/lib/drawio-formats/` に 3 つの reader/writer:
  - `drawio-xml.ts`: pako 圧縮判定 (先頭が `<mxfile`/`<mxGraphModel` か base64 か)、`pako` で deflate/inflate
  - `drawio-svg.ts`: DOMParser で SVG 読み込み、`<svg content="...">` 属性 と `<mxfile>` 子要素の両系統に対応、保存時は drawio から `format:'xmlsvg'` (=SVG with embedded XML) を要求
  - `drawio-png.ts`: `png-chunks-extract` / `png-chunks-encode` + `png-chunk-text` で `mxfile` zTXt チャンクの読み書き、保存時は drawio から `format:'xmlpng'` (=PNG with embedded XML) を要求
- `Plugin#registerView('drawio', leaf => new DrawioView(leaf, this))` を `onload` に追加
- `Plugin#registerExtensions(['drawio', 'svg', 'png'], 'drawio')` ではなく、**ファイル名で `.drawio.svg` / `.drawio.png` を判定** する独自登録方式を試す:
  - 案 A: `registerExtensions(['drawio'], 'drawio')` のみで `.drawio.svg` / `.drawio.png` は drawio として扱う (Obsidian の拡張子認識を確認)
  - 案 B: `vault.on('file-open')` をフックして `.drawio.svg` / `.drawio.png` を検出、`workspace.openLinkText` でビュー誘導
  - 案 C: 設定で「`.drawio.png` をエディタで開く」を opt-in 化し、組み込み image view との衝突を避ける
- どの案を取るかは実装スパイクで決定 (案 C をデフォルトに置く想定)
- 大きい PNG (1000 図形以上) を扱うときの memory spike 対策として、抽出/書き戻しを Web Worker に逃すかは後追い

## Scope

- **In**:
  - `DrawioView` (`FileView` サブクラス) の実装
  - 3 形式の reader / writer (XML / SVG / PNG)
  - `pako` / `png-chunks-extract` / `png-chunks-encode` / `png-chunk-text` 依存追加
  - `registerView` / `registerExtensions` (もしくは代替経路) の確立
  - PNG / SVG が「画像としても」開ける invariants の検証 (export 結果が valid PNG/SVG であること)
  - 保存時の format 維持 (元が PNG なら PNG、SVG なら SVG、`.drawio` なら XML)
  - drawio 側 `format:'xmlpng'` / `format:'xmlsvg'` の export request 経路
- **Out**:
  - drawio webapp / iframe 自体の構築 — drawio-embed-bridge
  - 設定 UI / テーマ追従 — drawio-settings-and-config
  - per-diagram の view 設定永続化 (iconset 等) — drawio-settings-and-config
  - `.vsdx` などの追加形式
  - 図のサムネイル生成

## Boundary Candidates

- **View 層**: `src/views/DrawioView.ts`
- **Format 層**: `src/lib/drawio-formats/{xml,svg,png}.ts`
- **登録層**: Plugin の `onload` 内で `registerView` / `registerExtensions` を呼ぶグルー
- **Vault I/O 層**: `Vault#read`, `Vault#readBinary`, `Vault#modify`, `Vault#modifyBinary` を統合する薄いラッパ

## Out of Boundary

- iframe / postMessage 自体の実装
- 設定スキーマ拡張 (本 spec は "format 設定 (圧縮維持等)" 程度の最小フラグのみ追加、本格 UI は settings spec)
- frontmatter / sidecar JSON での per-diagram 設定 — settings-and-config
- バックアップ / undo

## Upstream / Downstream

- **Upstream**:
  - plugin-foundation (`Plugin` クラス、設定 load/save、onload/onunload 規約)
  - drawio-embed-bridge (`DrawioBridge` クラス、`DrawioInbound` / `DrawioOutbound` 型)
- **Downstream**:
  - drawio-settings-and-config: 「保存形式」「圧縮の有無」などのトグルを設定 UI に追加

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**:
  - drawio-embed-bridge (postMessage 契約に依存)
  - plugin-foundation (`PluginSettings` を拡張する場合は本 spec が初出)

## Constraints

- **PNG metadata library license**: `png-chunks-extract` / `png-chunks-encode` / `png-chunk-text` (MIT) が Apache-2.0 互換、Electron desktop で動作することを確認
- **Pako**: deflate/inflate 用、MIT、bundle に含めて OK
- **No external network**: 全処理はローカル (Submission requirements)
- **File extension collision**: `.png` の組み込み image view との競合解決ポリシーをドキュメントに残す
- **Round-trip integrity**: 既存 PNG/SVG に入っている **その他のメタデータ** (画像本体の品質、SVG 内のスタイル等) を破壊しないことを reader/writer のテストで担保
- **Binary safety**: `Vault#modifyBinary` で書き戻す際は ArrayBuffer のまま渡す (string 経由禁止)
