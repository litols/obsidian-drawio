# Roadmap

## Overview

Obsidian の Vault 内に存在する draw.io ダイアグラム (`.drawio` / `.drawio.svg` / `.drawio.png`) を、別アプリへ離脱せずに **Obsidian 内のエディタとして** 閲覧・編集できる desktop-only コミュニティプラグインを作る。

draw.io の本体ロジックは jgraph/drawio (Apache-2.0) を `vendor/drawio` git submodule として取り込み、その `src/main/webapp/index.html` を `?embed=1&proto=json` で iframe 読み込みし、postMessage でホスト (Obsidian plugin) と双方向通信する。drawio-desktop (Electron) と同等のアーキテクチャ。

ビルドは vite-plugin-obsidian を使わず、**Vite の `build.lib` モード + `rollupOptions.external`** で obsidian-sample-plugin と同等の `main.js` (CJS) + `manifest.json` + `styles.css` を生成する。React は公式 docs (Use React in your plugin) に従って `createRoot`/`unmount` で組み込む。

## Approach Decision

- **Chosen**: Vendored drawio webapp + iframe + postMessage プロトコル (drawio-desktop 互換)
- **Why**:
  - drawio は npm パッケージ化されておらず、ソースを直接バンドルすると obsidian-sample-plugin の制約 (CDN 禁止 / minify 配布) と衝突する
  - drawio webapp は追加ビルド不要でそのまま動く (`src/main/webapp` 配下を vendor すれば iframe 読み込みで完結)
  - postMessage プロトコルは安定しており、host 側は薄いブリッジ層だけで実装できる
  - drawio-desktop が同じパターンを採用しているので IPC 設計が流用できる
- **Rejected alternatives**:
  - **mxgraph を直接 import して canvas/SVG レンダリング**: drawio の UI (パレット / 編集ツール) を再実装する必要があり工数が桁違い。却下。
  - **vite-plugin-obsidian / obsidian-vite テンプレート**: ユーザ指示で除外。Vite ネイティブ構成で実現する。
  - **drawio を npm fork して publish**: ライセンスは Apache-2.0 で可能だが、保守コストが恒常化する。submodule の方が upstream 追従が容易。

## Scope

- **In**:
  - Obsidian desktop plugin として `.drawio` / `.drawio.svg` / `.drawio.png` を **エディタとして登録** し閲覧・編集
  - 3 形式すべての読み書き (PNG: zTXt `mxfile` チャンク、SVG: `content` 属性 or `<mxfile>` 子要素、`.drawio`: 平文 XML / pako 圧縮 XML 自動判定)
  - drawio webapp を `vendor/drawio` submodule として取り込み iframe で表示
  - Plugin 設定 UI (テーマ light/dark/auto、shape libraries、デフォルト保存形式 など)
  - 図ごとのビュー設定 (iconset 読み込みなど) の永続化
  - Obsidian テーマ (light/dark) との追従
  - **外部変更の検知・自動 (or 手動) reload・通知・衝突解消** (AI エージェントなど Obsidian 外から `.drawio` が書き換えられるケースを一級で扱う)
  - Vite ベースの build / watch 構成
- **Out**:
  - **Mobile 対応** (`isDesktopOnly: true` で固定)
  - drawio クラウド機能 (Google Drive / OneDrive 連携、リアルタイム共同編集)
  - `.vsdx` / `.gliffy` / `.lucid` などの相互変換 (drawio の標準機能で開ける範囲は副次的に動くが保証しない)
  - drawio webapp 自体の改造 (upstream をそのまま vendor)
  - Community Plugin Registry への自動申請 (申請は視野に入れるがロードマップ外)

## Constraints

- **Platform**: Obsidian desktop (Electron) のみ。`isDesktopOnly: true`。
- **Submission requirements**: 将来 Community Plugin 申請を視野に入れるため、`innerHTML` 禁止 / 外部 CDN 禁止 / `onunload()` での完全 cleanup / Apache-2.0 ライセンスの正しい同梱を遵守。
- **Build**: Vite (`build.lib` + `formats: ['cjs']` + `rollupOptions.external` に `obsidian` / `electron` / Node builtins / `@codemirror/*` / `lezer`)。`vite-plugin-static-copy` で `manifest.json` / `styles.css` を出力ディレクトリに搬入。
- **drawio integration**: iframe + postMessage (`?embed=1&proto=json`)。`app://` または `file://` URL での webapp 読み込みは Obsidian Electron renderer の CSP と相互作用するため、初期スパイクで疎通を確認する (Risk: 必要なら `webSecurity` 緩和や `app://` プロトコルハンドラ登録の代替を検討)。
- **License**: drawio は Apache-2.0。本プラグイン本体のライセンスは別途決定するが、`vendor/drawio` の `LICENSE` / `NOTICE` を配布物に含める。
- **Tooling**: oxlint / oxfmt 継続使用 (steering tech.md 参照)。React 19 + TypeScript strict + `verbatimModuleSyntax`。

## Boundary Strategy

- **Why this split**: 5 つの spec は責任が直交する layer 分割。下層から積み上げて vertical slice として動く順序で並べているため、各 spec 単体で実装・レビュー可能。
  - Foundation = ビルド/manifest/設定インフラ (UIなしで `npm run build` 成果物が install できる状態)
  - Embed-bridge = drawio が iframe で表示されホストと通信できる (空の図でも何かしら描画される)
  - File-IO = 既存の Vault ファイルを drawio で開いて保存できる (3 形式対応、メタデータ保持)
  - Settings-and-config = テーマ追従 / shape libraries / per-diagram 設定永続化
  - External-sync = Vault 外 (CLI / AI エージェント / 別アプリ) からの変更検知・通知・再読込・衝突解消
- **Shared seams to watch**:
  - **postMessage プロトコル契約**: embed-bridge が定義するメッセージ型を file-io と settings-and-config が consume する。型を `src/lib/drawio-protocol.ts` 等で一元化。
  - **設定スキーマ**: foundation が定義する `loadData/saveData` ベースの設定スキーマを後段が拡張する。`PluginSettings` 型を破壊変更しないこと。
  - **ファイル拡張子登録**: `registerExtensions` の優先度問題 (`.png` は組み込み image view と衝突)。file-io が責任を持って解決する。
  - **テーマ伝播**: settings が決めたテーマを embed-bridge が iframe へ postMessage する。tight に結合しないよう host bus を経由。
  - **外部変更 ↔ ローカル編集の整合**: external-sync は file-io の reader/writer を `Vault.on('modify')` などの上で再呼び出しする。ローカル未保存編集 (drawio iframe 内 dirty) との衝突解消ポリシーを external-sync が単独で持つ。file-io は「現在 dirty か」「load を再実行できるか」を export する API のみ提供。

## Specs (dependency order)

- [x] plugin-foundation — Vite + obsidian-sample-plugin 互換ビルド、manifest.json、Plugin entry、loadData/saveData インフラ、テーマ検出 utility。Dependencies: none
- [x] drawio-embed-bridge — vendor/drawio submodule 追加、iframe 配置、postMessage プロトコル (load/autosave/save/export/exit)、host ↔ drawio bus。Dependencies: plugin-foundation
- [x] drawio-file-io — `registerView` + `registerExtensions` で `.drawio` / `.drawio.svg` / `.drawio.png` をエディタに登録、3 形式の読み書き (XML 圧縮判定 / SVG content 属性 / PNG zTXt `mxfile` チャンク)、Vault API 経由 I/O。Dependencies: plugin-foundation, drawio-embed-bridge
- [x] drawio-settings-and-config — PluginSettingTab (React)、テーマ light/dark/auto 追従、shape libraries / defaultLibraries 設定、per-diagram view 設定の永続化 (mxfile 属性 or sidecar)。Dependencies: plugin-foundation, drawio-embed-bridge
- [x] drawio-external-sync — Vault 外編集 (AI エージェント / CLI / 別アプリ) の検知、Notice / status bar 通知、自動 or 手動 reload、ローカル dirty 編集との衝突解消 (3-way merge は無理なので user prompt で resolve)、AI エージェント向け "diagram changed" イベント露出。Dependencies: plugin-foundation, drawio-embed-bridge, drawio-file-io

> **Status note (2026-05-10)**: 上記 `[x]` は **spec (requirements/design/tasks) 生成完了** を示す。実装はこれから (`/kiro-impl <feature>`)。
>
> **実装 wave 順序の注意**: cross-spec review で発覚した整合上、**drawio-file-io と drawio-settings-and-config は同 wave で実装する**ことを推奨 (file-io が legacy トップレベル設定を追加 → settings の `migrateSettings` が `drawio.*` 名前空間へ吸収するため、file-io 単独実装ではコンパイルが通らない可能性)。実装時は file-io spec の `DrawioSettings` 型を settings spec と並走させるか、stub を先に置くこと。

## Phase 2 (2026-05-10 追加)

ホスト側 UI の英語対応と、嫌悪された sidecar JSON 構造の廃止。

### Existing Spec Updates

- [x] drawio-settings-and-config — **per-diagram 設定機能そのものを廃止**。要件 4 (sidecar `<file>.drawio.json` 永続化) と要件 5 (`DiagramSettingsModal` per-diagram 編集 UI) を削除し、mxfile への埋め込み代替案も採用しない。設定はグローバル (`PluginSettings.drawio.*`) のみ。`src/lib/per-diagram-config.ts` / `src/views/DiagramSettingsModal.tsx` / 関連 rename・delete subscription / sidecar 除外ロジック / `drawio: 図の設定を編集` command を撤去。merge 関数も per-diagram レイヤを除去してグローバル直読みに簡略化。Dependencies: なし (純粋な削減リファクタ)。

### Specs (dependency order)

- [x] plugin-i18n — プラグイン自身の UI 文字列 (Notice / Settings / Modal / Banner / Diff Modal / Command name 等) を ja/en で切り替えられる i18n 基盤と en リソースを提供する。Obsidian locale 追従 + 明示選択 + フォールバック。drawio iframe 自体の `language` 設定 (drawio-settings-and-config 要件 6) とは独立。Dependencies: plugin-foundation, drawio-settings-and-config (`language` 設定キーへの相乗り or 別キー新設の判断はこの spec で行う)。**実装 wave 上の前提**: `src/views/SettingsTab.tsx` を改変するタスク (plugin-i18n tasks 3.4 / 4.1 等) は drawio-settings-and-config の SettingsTab 構築 (tasks 3.x) 完了後に着手すること。SettingsTab.tsx 未存在の状態で plugin-i18n を走らせるとコンパイル不整合になる。

### Direct Implementation Candidates

- なし (どちらも spec 境界をまたぐ変更のため直書き不可)
