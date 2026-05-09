# Requirements Document

## はじめに

`plugin-foundation` は、既存の Vite + React + TypeScript SPA テンプレートを Obsidian コミュニティプラグインとして動作する最小基盤へ変換する。`pnpm build` で `dist/main.js` (CommonJS)・`dist/manifest.json`・`dist/styles.css` が生成され、Obsidian Vault の `.obsidian/plugins/obsidian-drawio/` に配置するとプラグインとして読み込まれる状態を実現する。設定永続化レイヤ・テーマ検出 utility・React マウント utility も本 spec が提供し、後続 spec (drawio-embed-bridge / drawio-file-io / drawio-settings-and-config) が共通基盤として利用できるようにする。

## Boundary Context

- **スコープ内**: Vite build/watch/minify 構成、manifest.json 雛形、styles.css 出力経路、Plugin サブクラス (onload/onunload)、設定 load/save インフラ (`PluginSettings` 型 + DEFAULT_SETTINGS)、テーマ検出 utility、React マウント utility、既存 SPA テンプレートファイルの除去、package.json/tsconfig.json の整理
- **スコープ外**: drawio submodule・iframe・postMessage (drawio-embed-bridge 担当)、`registerView`/`registerExtensions` (drawio-file-io 担当)、設定 UI (drawio-settings-and-config 担当)、hot-reload (pjeby) 統合、Mobile 対応
- **隣接仕様への期待**: 後続 spec は `PluginSettings` 型を破壊変更せずに拡張する。`src/lib/react-mount.ts` の API を利用して React root を管理する。Plugin クラスを継承または利用して機能を追加する。

## 要件

### 要件 1: Vite ビルド構成

**目的**: プラグイン開発者として、Vite の `build.lib` モードで CommonJS 形式のプラグインバンドルをビルドしたい。Obsidian が要求する `main.js` 形式の成果物を生成できるようにするため。

#### 受入基準

1. When `pnpm build` を実行したとき、the プラグインビルドシステム shall `dist/main.js` (CommonJS 形式) を生成する
2. When `pnpm build` を実行したとき、the プラグインビルドシステム shall TypeScript 型チェック (`tsc -b`) をビルド前に実行しエラーがある場合は失敗する
3. When `pnpm dev` を実行したとき、the プラグインビルドシステム shall `vite build --watch` を起動しソース変更を即座に `dist/` へ反映する
4. The プラグインビルドシステム shall `obsidian`、`electron`、Node.js builtins (`path`、`fs` など)、`@codemirror/*`、`lezer` パッケージをバンドルから除外する (`rollupOptions.external`)
5. The プラグインビルドシステム shall React (`react`、`react-dom`) をバンドルに含める
6. The プラグインビルドシステム shall ビルドターゲットを ES2018 相当に設定し、Obsidian の Electron renderer 環境で動作させる

### 要件 2: 配布物の整備 (manifest.json・styles.css)

**目的**: プラグイン開発者として、Obsidian が認識できる manifest.json と styles.css を dist/ に含めたい。プラグインが Vault に配置されたとき Obsidian が正しく読み込めるようにするため。

#### 受入基準

1. The プラグイン配布物 shall `manifest.json` を含み、`id: "obsidian-drawio"`、`name`、`version`、`description`、`author`、`isDesktopOnly: true`、`minAppVersion` フィールドを持つ
2. When `pnpm build` を実行したとき、the プラグインビルドシステム shall `manifest.json` を `dist/manifest.json` へコピーする
3. When `pnpm build` を実行したとき、the プラグインビルドシステム shall `styles.css` を `dist/styles.css` へコピーする
4. When `dist/` の内容を Obsidian Vault の `.obsidian/plugins/obsidian-drawio/` に配置したとき、the Obsidian shall プラグインを認識し有効化できる
5. The `manifest.json` shall `isDesktopOnly: true` を設定し Mobile 環境での読み込みを防ぐ
6. The `manifest.json` shall `minAppVersion` を `"1.4.0"` 以上に設定する (Workspace `css-change` 等の安定 API 利用を保証するため)

### 要件 3: Plugin エントリポイント

**目的**: プラグイン開発者として、Obsidian Plugin API に準拠した `Plugin` サブクラスを実装したい。プラグインのライフサイクル (load/unload) を正しく管理できるようにするため。

#### 受入基準

1. The Plugin エントリ shall Obsidian の `Plugin` クラスを継承し `onload()` と `onunload()` を実装する
2. When Obsidian がプラグインを有効化したとき、the Plugin エントリ shall `onload()` を呼び出し設定の読み込みとサービスの初期化を行う
3. When Obsidian がプラグインを無効化または Vault を閉じたとき、the Plugin エントリ shall `onunload()` を呼び出しすべてのイベントリスナー・DOM 要素・React root を dispose する
4. The Plugin エントリ shall `innerHTML` を使用しない (Obsidian コミュニティプラグイン審査要件)

### 要件 4: 設定永続化インフラ

**目的**: プラグイン開発者として、`loadData`/`saveData` ベースの設定読み書きインフラを利用したい。後続 spec が同一の永続化機構を拡張できるようにするため。

#### 受入基準

1. The 設定インフラ shall `PluginSettings` 型と `DEFAULT_SETTINGS` 定数を export する
2. When プラグインが `onload()` を実行したとき、the 設定インフラ shall `loadData()` を呼び出し保存済み設定を `DEFAULT_SETTINGS` とマージして読み込む
3. When 設定が変更されたとき、the 設定インフラ shall `saveData()` を呼び出し変更を Vault に永続化する
4. The `PluginSettings` 型 shall 後続 spec がフィールドを追加できるよう拡張可能な構造として定義される
5. If `loadData()` が null または undefined を返したとき、the 設定インフラ shall `DEFAULT_SETTINGS` の値で初期化する
6. The 設定インフラ shall `Object.assign({}, DEFAULT_SETTINGS, persisted)` 相当のシャローマージで `loadData()` の結果を `DEFAULT_SETTINGS` に被せ、後続 spec が新フィールドを追加しても既存 Vault との後方互換が保たれる

### 要件 5: テーマ検出 utility

**目的**: プラグイン開発者として、Obsidian の現在テーマ (light/dark) を取得し変更を検知できる utility を利用したい。後続 spec が drawio iframe のテーマと Obsidian テーマを同期できるようにするため。

#### 受入基準

1. The テーマ検出 utility shall `document.body` の `theme-dark` クラスの有無を検査して現在のテーマ (`'light'` または `'dark'`) を返す関数を提供する
2. The テーマ検出 utility shall Obsidian の `workspace.on('css-change')` イベントを購読してテーマ変更を検知できる関数を提供する
3. When `css-change` イベントが発火したとき、the テーマ検出 utility shall 登録されたコールバックを現在のテーマ値とともに呼び出す
4. When テーマ検出 utility が dispose されたとき、the テーマ検出 utility shall `css-change` イベントのリスナーを `Workspace.offref(eventRef)` で解除する
5. The テーマ検出 utility shall 購読関数の戻り値として `() => void` 型の dispose 関数を返し、Plugin の `onunload()` で確実に解除できるようにする

### 要件 6: React マウント utility

**目的**: プラグイン開発者として、React root のマウント・アンマウントを管理する薄い wrapper を利用したい。後続 spec が React コンポーネントを安全にマウント・クリーンアップできるようにするため。

#### 受入基準

1. The React マウント utility shall 指定された DOM 要素に React コンポーネントを `createRoot` でマウントする関数を提供する
2. The React マウント utility shall マウントされた React root を `unmount()` で安全に解除する関数を提供する
3. When Plugin の `onunload()` が呼ばれたとき、the React マウント utility shall すべての管理下にある React root を unmount する
4. If 同一 DOM 要素に対して重複してマウントが試みられたとき、the React マウント utility shall 既存の root を unmount してから新しくマウントする

### 要件 7: 既存 SPA テンプレートの除去とプロジェクト整理

**目的**: プラグイン開発者として、Obsidian プラグインとして不要な SPA テンプレートファイルを除去し、package.json と tsconfig.json をプラグイン開発向けに整理したい。クリーンな基盤から後続 spec を実装できるようにするため。

#### 受入基準

1. The プロジェクト shall `src/App.tsx`、`src/main.tsx`、`index.html` などの SPA テンプレートファイルを含まない
2. The `package.json` shall `obsidian` パッケージを `devDependencies` に配置する
3. The `package.json` shall `vite-plugin-static-copy` 等のビルド補助パッケージを `devDependencies` に含める
4. The `tsconfig.json` shall Obsidian プラグイン向けに DOM 型と Node.js 型を含める
5. The `tsconfig.json` shall `strict: true`、`verbatimModuleSyntax: true`、`erasableSyntaxOnly: true` を維持する
6. The oxlint/oxfmt 設定 shall `dist/` ディレクトリを lint/format の対象外に設定する
7. When `pnpm lint` を実行したとき、the lint ツール shall `dist/` を除外してソースファイルを検査する
