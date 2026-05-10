# Brief: automated-testing

## Problem

obsidian-drawio プラグインは 5 つの spec (plugin-foundation / drawio-embed-bridge / drawio-file-io / drawio-settings-and-config / drawio-external-sync) を経て実装されたが、**Obsidian 上での実機統合動作を検証する自動テストが存在しない**。

- 各 spec の単体ロジック (XML 圧縮判定、PNG zTXt、postMessage プロトコル) は手動で確認しているのみ
- iframe (drawio webapp) と host (Obsidian plugin) の postMessage handshake は実機でしか再現できない
- 外部変更検知 / dirty 衝突解消などのフローは Vault と連動するため Obsidian 起動なしでは検証不能
- Community Plugin 申請を視野に入れると、最低限の E2E スモークが回帰防止に必須

## Current State

- `package.json` にテスト関連の script / devDependency なし
- `tests/` `e2e/` 等のディレクトリ未作成
- vendor/drawio submodule は実装済 (drawio-embed-bridge spec)
- ビルドは `pnpm build` で `main.js` + `manifest.json` + `styles.css` を出力済 (plugin-foundation spec)

## Desired Outcome

- `pnpm e2e:setup` で Obsidian 本体抽出 + フィクスチャ vault 初期化が走る
- `pnpm e2e` で Playwright が Obsidian Electron を起動し、各 spec の代表的なユーザシナリオを通しで検証する
- ローカル (macOS) と GitHub Actions (macos-latest) の双方で同じ E2E が green
- 開発者が `pnpm e2e --ui` で Playwright Inspector を立ち上げて debug できる
- PR と main への push の双方で、GitHub Actions が **基本検証 (lint / format / typecheck / build / unit test) と E2E** を並列実行し、両方 green が merge 条件になる
- `pnpm test` で vitest が起動し、各 spec の純粋ロジック (XML 圧縮判定、PNG zTXt encode/decode、SVG content 属性 read/write、postMessage プロトコル shape、settings migrate、external diff など) を高速に検証できる

## Approach

Obsidian plugin の実機 E2E に成熟したパターン (Electron 直接起動 + asar 抽出 + symlink プラグイン配置) を採用し、drawio 固有の iframe / 3 形式に合わせて拡張する。

- Playwright `_electron.launch()` で Obsidian Electron を起動
- `scripts/setup-obsidian.sh` が `/Applications/Obsidian.app` (ローカル) または `gh release download` (CI) から `app.asar` を取得し `@electron/asar` で `.obsidian-unpacked/` へ展開
- ビルド済 `main.js` / `manifest.json` / `styles.css` をフィクスチャ vault `e2e-vault/.obsidian/plugins/obsidian-drawio/` へ **symlink**
- `e2e-vault/.obsidian/community-plugins.json` でプラグイン ID を事前登録、`e2e:setup` で trust author ダイアログを初回突破
- 以降は `obsidian://open?path=<vault>` で起動
- drawio iframe には Playwright `frameLocator()` でアクセス、postMessage の発火検証は `page.evaluate()` 内で `window.postMessage` を傍受

## Scope

- **In**:
  - `scripts/setup-obsidian.sh` (ローカル / `--ci` 両対応)
  - `playwright.config.ts` (`e2e-setup` / `e2e` の 2 project, `fullyParallel: false`, `timeout: 300s`)
  - `e2e-vault/` フィクスチャ (vault 設定 + サンプル `.drawio` / `.drawio.svg` / `.drawio.png` を git commit)
  - `tests/e2e-setup/setup.ts` (Obsidian 初回起動 + trust author + cleanup)
  - `tests/e2e/*.spec.ts` — 各 spec の代表シナリオ
    - foundation: プラグインが有効化され status bar / settings tab が出る
    - embed-bridge: 空ファイルを開いて drawio iframe が `init` event を返す
    - file-io: 3 形式 (`.drawio` / `.drawio.svg` / `.drawio.png`) を開いて iframe にロードされる、保存後ファイルが書き換わる
    - settings-and-config: テーマ追従 (light/dark)、shape libraries 設定の永続化
    - external-sync: vault 内ファイルを fs で書き換え → reload バナー表示 → 採用/却下フロー
  - `package.json` scripts (`e2e:setup` / `e2e:cleanup` / `e2e`) と devDependencies (`@playwright/test`, `electron`, `@electron/asar`)
  - **Unit test 基盤** (vitest)
    - `vitest.config.ts` を Vite 構成と共有 (`mergeConfig` でビルド config を再利用、`environment: 'node'` ベース、`jsdom` は必要箇所のみ)
    - `src/**/*.test.ts` または `src/**/*.spec.ts` を共置パターンとして採用
    - `obsidian` モジュール / `vendor/drawio` への依存は test では mock / 直接 import を避ける (純粋ロジックレイヤを対象)
    - 対象 (代表例): `drawio-file-io` の XML 圧縮判定 / PNG zTXt mxfile encode・decode / SVG content 属性 read/write、`drawio-embed-bridge` の postMessage envelope shape、`drawio-settings-and-config` の `migrateSettings`、`drawio-external-sync` の diff/conflict 判定
    - `pnpm test` (一回実行) と `pnpm test:watch` を `package.json` に追加
    - devDependencies: `vitest`, `@vitest/coverage-v8` (任意)
  - 開発者向け README セクション (unit / E2E 双方の実行手順)
  - GitHub Actions workflow を **2 段構成** で整備 (PR + main branch push の双方で実行)
    - **基本検証 job**: ubuntu-latest 上で `pnpm install` → `pnpm lint` → `pnpm format:check` → `pnpm test` (vitest) → `pnpm build` (typecheck 込み)。E2E より高速で全 PR の必須 gate
    - **E2E job**: macos-latest 上で submodule init + Obsidian 抽出 + `pnpm e2e:setup` → `pnpm e2e` を実行
    - 2 つの job は並列実行、両方 green が main merge の条件
- **Out**:
  - Linux / Windows での E2E 実行 (将来課題)
  - drawio webapp 内部 (パレット操作 / ノード追加など) の深い操作テスト — 起動と load/save の通信疎通までを範囲とする
  - パフォーマンス / メモリリーク計測
  - Visual regression (スクリーンショット差分)
  - 既存実装コードへの大規模なリファクタ (unit test を書きやすくするための分割は最小限に留め、testable でない箇所は未着手として残す)
  - 100% カバレッジ目標 (まずは pure logic 層のみ。obsidian API に直接触るコードはカバレッジ対象外)
  - Community Plugin Registry への自動申請

## Boundary Candidates

- **Unit test 基盤レイヤ**: vitest 設定 / pure logic を切り出すための薄い refactor / mock 戦略
- **Unit test 実装レイヤ**: 各 spec の pure logic 層に対する `*.test.ts`
- **E2E 基盤レイヤ**: setup script / playwright config / vault フィクスチャ / 共通ヘルパ (frameLocator wrapper, vault writer)
- **E2E シナリオレイヤ**: spec ごとの `*.spec.ts`
- **CI レイヤ**: GitHub Actions workflow (基本検証 job + E2E job の 2 段構成) + secrets / cache 設定

## Out of Boundary

- 既存 spec のロジック変更 (E2E で発覚したバグは別 spec の修正としてフィードバック)
- drawio webapp 自体への手入れ
- Mobile プラットフォーム対応
- vitest / unit test 基盤

## Upstream / Downstream

- **Upstream**:
  - plugin-foundation (ビルド成果物 `dist/main.js` の存在前提)
  - drawio-embed-bridge (vendor/drawio submodule + postMessage プロトコル)
  - drawio-file-io (3 形式 reader/writer + view 登録)
  - drawio-settings-and-config (settings tab + theme bridge)
  - drawio-external-sync (ExternalWatcher + reload banner)
- **Downstream**:
  - Community Plugin 申請時の品質エビデンス
  - 将来的な regression CI gate (PR ごとに E2E を必須化する判断)

## Existing Spec Touchpoints

- **Extends**: なし (新規 spec)
- **Adjacent**:
  - 全 5 spec の I/O API を読み取り側として使用するが、API 自体は変更しない
  - もし API が E2E から扱えない (例: ExternalWatcher が公開イベントを持たない) ことが発覚したら、該当 spec への enhancement リクエストとして切り出す

## Constraints

- **Platform**: macOS のみ初期サポート (`@electron/asar` 抽出 + Obsidian.app の場所が macOS 前提)
- **Obsidian version**: `package.json` の `obsidian: ^1.12.3` と整合する Obsidian release を CI で固定 (浮動 latest にしない方が再現性が高い)
- **Submodule**: `vendor/drawio` を CI で `git submodule update --init --recursive` してからビルドが必要
- **License**: `@playwright/test` (Apache-2.0), `electron` (MIT), `@electron/asar` (MIT) — 既存 Apache-2.0 vendor との衝突なし
- **Build**: 既存 Vite ビルドへの影響を出さない (テスト依存は devDependencies のみ)
- **Tooling**: oxlint / oxfmt の対象に `tests/` を含めるか別途検討 (Playwright の test runner 構文との相性確認が必要)
- **CI runner**: 基本検証 job は `ubuntu-latest` (高速・コスト低)、E2E job は `macos-latest` 固定。Linux runner で Obsidian を動かす方式 (xvfb + AppImage) は将来課題
- **Trigger**: 双方の job を `pull_request` と `push: branches: [main]` の両方で実行。両 job が green になることを main merge の条件にする (branch protection は別途 GitHub 側設定)
