# Brief: plugin-foundation

## Problem

現状リポジトリは Vite + React + TypeScript の SPA テンプレート (`initial commit`) で、Obsidian プラグインとしては動かない。`main.js` (CommonJS) + `manifest.json` + `styles.css` を Vault の `.obsidian/plugins/<id>/` に配置すれば load される、という Obsidian の規約に乗る最小構成がまだ存在しない。

## Current State

- `vite.config.ts`: 通常の SPA build (HTML エントリ、ESM)
- `src/`: React のサンプル (`App.tsx`, `main.tsx`)
- `manifest.json` 不在、`styles.css` 不在、Plugin エントリ (`extends Plugin`) 不在
- 設定永続化レイヤ (loadData/saveData) なし
- テーマ検出 utility なし
- `package.json` の `dependencies` に `obsidian` 型定義なし

## Desired Outcome

- `pnpm build` で `dist/main.js` (CJS) + `dist/manifest.json` + `dist/styles.css` が出力される
- `pnpm dev` で `vite build --watch` が起動し、変更が即座に `dist/` に反映される
- `dist/` を Obsidian Vault の `.obsidian/plugins/obsidian-drawio/` にシンボリックリンク or コピーすると、Obsidian が plugin としてロードし enable できる
- Plugin が `onload` / `onunload` を実装しており、設定の `loadData` / `saveData` インフラと、Obsidian テーマ (light/dark) を検出する utility が用意されている
- 後続 spec (embed-bridge, file-io, settings) がこの基盤の上にだけビルドすれば良い状態

## Approach

- Vite を `build.lib` モード (entry: `src/main.ts`, formats: `['cjs']`, fileName: `'main.js'`) で構成
- `rollupOptions.external` に `obsidian` / `electron` / Node builtins / `@codemirror/*` / `lezer` を列挙
- `@vitejs/plugin-react` で JSX を CJS バンドルへ展開 (React は external せず bundle に含める)
- `vite-plugin-static-copy` で `manifest.json` / `styles.css` を `dist/` へ搬入
- Plugin エントリ `src/main.ts` で `extends Plugin` クラスを定義、`loadData` / `saveData` ベースの設定スキーマと、`document.body` の `theme-dark` クラス + `workspace.on('css-change')` ベースのテーマ検出 utility を実装
- `manifest.json` は `isDesktopOnly: true`、`minAppVersion: "1.0.0"` 以上で初版を発行

## Scope

- **In**:
  - Vite build / watch / production minify 構成
  - `manifest.json` 雛形 (id, name, version, description, author, isDesktopOnly, minAppVersion)
  - `styles.css` 雛形 (空でも可、出力経路の確立)
  - `src/main.ts`: `Plugin` サブクラス、onload/onunload、設定 load/save
  - `src/lib/settings.ts`: `PluginSettings` 型 + DEFAULT_SETTINGS + load/save helper (空のスキーマで OK、後続 spec が拡張)
  - `src/lib/theme.ts`: 現在テーマ取得 + `css-change` 購読 utility
  - `src/lib/react-mount.ts`: `createRoot` + `unmount` を扱う薄い wrapper (後続 React UI で使用)
  - 既存 `src/App.tsx` / `src/main.tsx` / `index.html` / Vite テンプレ系ファイルの除去
  - `package.json` の scripts / dependencies 整理 (`obsidian` を `devDependencies`、React は `dependencies`、`vite-plugin-static-copy` 等を追加)
  - `tsconfig.json` を Obsidian plugin 向けに調整 (DOM + Node 型、`erasableSyntaxOnly` 維持)
  - oxlint / oxfmt の設定継続 (出力 `dist/` を ignore)
- **Out**:
  - drawio submodule、iframe、postMessage 一切 (drawio-embed-bridge spec 担当)
  - `registerView` / `registerExtensions` (drawio-file-io spec 担当)
  - 設定 UI (drawio-settings-and-config spec 担当)
  - hot-reload (pjeby) 統合 (任意)

## Boundary Candidates

- **ビルド層**: `vite.config.ts`, `tsconfig.json`, `package.json` scripts
- **Plugin entry 層**: `src/main.ts` の `Plugin` サブクラス
- **横断 utility 層**: `src/lib/{settings,theme,react-mount}.ts`
- **配布物層**: `dist/main.js`, `dist/manifest.json`, `dist/styles.css`

## Out of Boundary

- drawio webapp の vendor 取り込み — drawio-embed-bridge が担当
- 図ファイルの読み書き API — drawio-file-io が担当
- 実際の設定 UI 描画 — drawio-settings-and-config が担当
- Community Plugin 申請 / Marketplace 提出 — ロードマップ外
- Mobile build — 永続的に out of scope (`isDesktopOnly: true`)

## Upstream / Downstream

- **Upstream**: 既存の Vite + React テンプレート (除去 or 全面置換)、Obsidian Plugin API 型定義 (`obsidian` package)
- **Downstream**:
  - drawio-embed-bridge (`Plugin` サブクラスに iframe マウント / postMessage bus を生やす)
  - drawio-file-io (`Plugin#registerView` / `Plugin#registerExtensions` 呼び出し場所)
  - drawio-settings-and-config (`PluginSettings` 型を拡張、`PluginSettingTab` を追加)

## Existing Spec Touchpoints

- **Extends**: なし (新規 spec のみ)
- **Adjacent**: なし (現時点で他 spec なし)

## Constraints

- **Build format**: CommonJS、ターゲット ES2018 程度 (Obsidian の Electron renderer が要求する範囲)
- **External**: `obsidian` / `electron` / Node builtins / `@codemirror/*` / `lezer` を bundle に含めない
- **Submission requirements 準備**: `innerHTML` 不使用、外部 CDN 不参照、`onunload` で event listener / DOM / React root すべて dispose
- **TypeScript**: strict + `verbatimModuleSyntax` + `erasableSyntaxOnly` (steering/tech.md 準拠)
- **Lint/Format**: oxlint / oxfmt を継続使用 (`dist/` は ignore)
- **License**: 本プラグイン本体のライセンスは未定だが、`LICENSE` ファイルを置く前提でディレクトリを準備
