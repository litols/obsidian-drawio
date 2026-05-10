# Research & Design Decisions

## Summary

- **Feature**: `automated-testing`
- **Discovery Scope**: Extension (既存 5 spec 実装済プロジェクトへの test 基盤追加)
- **Key Findings**:
  - 既存実装の純粋ロジック層 (`src/lib/drawio-formats/*`、`drawio-protocol.ts`、`settings.ts` の `migrateSettings`、`theme-bridge.ts` の `resolveBridgeTheme`、`DiffModal.tsx` の `simpleLineDiff` 等) は **obsidian / Electron 依存なし** で import 可能なため、vitest の Node 環境で直接 unit test できる
  - `drawio-bridge.ts` の `postMessage` 送受信、`external-watcher.ts` の `Vault.on('modify')` 配線、`DrawioView.ts` の load/save サイクル、`SettingsTab.tsx` のレンダリングは **Obsidian runtime に密結合** で unit test 困難 → E2E でカバー
  - `vendor/drawio` は build 時に `vite-plugin-static-copy` で `dist/drawio/` へコピーされ、iframe 配信される。E2E ではこの成果物を vault 内 plugin ディレクトリへ symlink する形で間接利用
  - GitHub Actions workflow は未整備 (`.github/workflows/` 不在)。lint/format/typecheck/build/test を回す PR gate がないため、本 spec 完了で初めて CI gate が成立する

## Research Log

### Topic: Obsidian プラグインの E2E 起動方式

- **Context**: Playwright で Obsidian Electron アプリを駆動する手段の確認
- **Sources Consulted**: Playwright `_electron` API ドキュメント、`@electron/asar` package README、Obsidian `app.asar` のリソース構造調査
- **Findings**:
  - Playwright は `playwright._electron.launch({ args: [main.js, ...] })` で任意の Electron アプリを起動可能
  - Obsidian.app の `Contents/Resources/app.asar` を `npx @electron/asar extract` で展開すると `main.js` が露出し、これを Playwright の `args[0]` に渡せる
  - `obsidian.asar` は別途参照ロードされるため、`app.asar` 抽出後ディレクトリへ同階層コピーが必要
  - Trust author ダイアログ (community plugin 初回ロード時) を `setup` で 1 回突破した後、`workspace.json` を保持すれば後続 test では再表示されない
- **Implications**: setup は 2 段階 (`scripts/setup-obsidian.sh` でバイナリ抽出、`tests/e2e-setup/setup.ts` で trust ダイアログ突破) で構成する

### Topic: vitest と既存 Vite 設定の共存

- **Context**: 既存 `vite.config.ts` (build.lib + CJS + react plugin + static-copy) を test 実行時に再利用するか分離するか
- **Sources Consulted**: vitest 公式ドキュメント `mergeConfig`、vitest `defineProject`、既存 `vite.config.ts`
- **Findings**:
  - `vitest.config.ts` で `mergeConfig(viteConfig, { test: { ... } })` パターンが安定形
  - test 実行時は plugin build (`build.lib`) や `vite-plugin-static-copy` を走らせる必要がないため、`test` セクション内で `environment: 'node'`、`include: ['src/**/*.{test,spec}.ts']` を指定し、build 出力には影響を出さない
  - `obsidian` package は本体の peer 依存だが test では呼ばれないため、明示 mock は不要 (該当ロジックを test 対象から除外する設計)
- **Implications**: Vite 既存設定を破壊せず、`vitest.config.ts` 単独で test の責務を表現する

### Topic: drawio iframe との Playwright 連携

- **Context**: drawio webapp (vendor/drawio) は plugin が iframe としてマウントするため、Playwright で iframe 内 DOM を操作する手段が必要
- **Sources Consulted**: Playwright `frameLocator` API、既存 `drawio-bridge.ts` の `iframe.contentWindow.postMessage` 実装
- **Findings**:
  - `page.frameLocator('iframe[data-drawio]')` で iframe 内 DOM を locator として扱える
  - drawio iframe 自体の DOM 検証 (例: 「キャンバス要素の存在」) と postMessage 通信検証 (host → iframe / iframe → host) は別アプローチ
  - postMessage 通信は `page.evaluate()` から `window.addEventListener('message', ...)` を仕込む形で観測可能
- **Implications**: `tests/helpers/drawio-frame.ts` に「iframe 取得」「postMessage 観測」のラッパを集約する

### Topic: GitHub Actions 2 段構成と再現性

- **Context**: 基本検証 (Linux) と E2E (macOS) を並列実行する workflow の設計
- **Sources Consulted**: GitHub Actions `runs-on`、`needs`、`strategy`、`actions/cache`、`pnpm/action-setup`
- **Findings**:
  - `jobs.basic` (ubuntu-latest) と `jobs.e2e` (macos-latest) を `needs` で連結せず並列に書けば独立 Check が出る
  - `actions/cache` で `~/.local/share/pnpm/store` をキャッシュ可、Obsidian バイナリは `setup-obsidian.sh` 出力 `.obsidian-unpacked/` を別キャッシュに
  - macos-latest は使用枠の消費が大きいため、`paths` フィルタを将来導入する余地は残すが本 spec では固定 trigger
  - Obsidian バージョンを fixed pin することで CI flake を抑える
- **Implications**: workflow に Obsidian バージョン固定変数を持ち、cache key にも含める

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| **Adopt: vitest + Playwright + Electron** | 確立された runner 群を組み合わせ、薄い helper だけ自作 | エコシステム成熟、メンテ最小、Vite と相性良 | macOS 依存 (Obsidian 抽出経路) | 採用 |
| Custom Electron driver (Spectron 系) | 自作で Electron を fork して制御 | 高い自由度 | Spectron は廃止済、再発明コスト過大 | 却下 |
| Unit test のみ (E2E スキップ) | postMessage / Vault 連動を mock で代替 | 軽量・速い | iframe 通信や view lifecycle の regression を検出不能 | 却下 |
| jest + ts-jest | 別 runner | 汎用性 | Vite と config 二重化 / TypeScript strict との摩擦 | 却下 |

## Design Decisions

### Decision: vitest を採用 (jest 不採用)

- **Context**: Unit test runner の選択
- **Alternatives Considered**:
  1. vitest — Vite 共有、TypeScript strict / `verbatimModuleSyntax` と素直に共存
  2. jest + ts-jest — 別個の transpile pipeline
- **Selected Approach**: vitest を採用、`vitest.config.ts` で `mergeConfig(viteConfig, ...)` 構成
- **Rationale**: 既存 Vite 設定 (`@vitejs/plugin-react`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) を再利用でき、設定二重管理を避けられる
- **Trade-offs**: vitest はまだ jest ほど周辺 plugin が豊富ではないが、本 spec のターゲット (純粋ロジック) には十分
- **Follow-up**: jsdom が必要な test が出てきた場合は per-file `// @vitest-environment jsdom` で局所適用

### Decision: Playwright `_electron` を採用 (Spectron / Puppeteer-electron 不採用)

- **Context**: Obsidian Electron 起動の技術選定
- **Alternatives Considered**:
  1. Playwright `_electron` API — 公式サポート、active メンテ
  2. Spectron — 既に廃止済
  3. Puppeteer + `puppeteer-electron` — 第三者 fork、メンテ不安
- **Selected Approach**: `@playwright/test` + `playwright._electron.launch()`
- **Rationale**: Playwright は `frameLocator` / `trace` / `--ui` モード等 debug 機能が充実、Electron API も一級でサポート
- **Trade-offs**: Electron バージョン互換性は Playwright バージョンに依存 → 本 spec では Playwright を pin
- **Follow-up**: Playwright と Electron の組み合わせの互換マトリクスを README に明記

### Decision: フィクスチャ vault を repo に commit (gitignore せず)

- **Context**: `e2e-vault/` の管理方針
- **Alternatives Considered**:
  1. Commit する — 内容が固定で diff 可視
  2. Gitignore + setup スクリプトで毎回生成
- **Selected Approach**: commit する。ただし `e2e-vault/.obsidian/workspace.json` 等の実行時生成物は gitignore + `e2e:cleanup` で初期化
- **Rationale**: サンプル `.drawio` / `.drawio.svg` / `.drawio.png` の content が確定的で test 期待値と紐付く。生成スクリプトより repo diff で内容変化が見える方が安全
- **Trade-offs**: PNG バイナリが repo サイズに加算される (許容範囲)
- **Follow-up**: `.gitignore` で workspace.json / hot-reload 系を除外する範囲を明記

### Decision: Obsidian バージョンを CI で固定 pin

- **Context**: `gh release download` で取得する Obsidian `.dmg` のバージョン管理
- **Alternatives Considered**:
  1. `latest` を毎回取得
  2. workflow env でバージョン pin
- **Selected Approach**: workflow env `OBSIDIAN_VERSION` で固定 pin、定期的に手動更新
- **Rationale**: Obsidian の minor リリースで UI セレクタが変わると flake する。pin することで CI 安定性と更新タイミングを分離
- **Trade-offs**: 手動更新コスト発生 (許容)
- **Follow-up**: `manifest.json` の `minAppVersion` (`1.4.0`) と整合する範囲で最新を選ぶ運用ルールを README に書く

## Risks & Mitigations

- **Risk: Obsidian.app の内部構造変更で `setup-obsidian.sh` が破綻** → バージョン pin + setup スクリプトに前提 (`app.asar` の存在) を assert する明示エラーを実装
- **Risk: drawio iframe の `init` event が race condition で取りこぼされる** → `tests/helpers/drawio-frame.ts` に `waitForReady()` を実装、polling + timeout で堅牢化
- **Risk: macos-latest runner の使用枠コスト増大** → 並列 job 構造により基本検証は ubuntu で受け持ち、macOS は E2E のみに限定。将来必要なら `paths` フィルタで PR 範囲を絞る
- **Risk: trust author ダイアログの UI 変更で setup が失敗** → setup を独立 project 化し、ダイアログ未表示ケース (既に trust 済) もハンドリング
- **Risk: 外部変更検知 E2E で `node:fs` 書き込みが echo suppression にマッチして検知漏れ** → fs 書き込み前に十分な sleep + `recentSelfWrites` の TTL 外で実行する helper を提供

## References

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [@electron/asar](https://github.com/electron/asar)
- [vitest configuration](https://vitest.dev/config/)
- [Obsidian Plugin Documentation — Testing](https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins)
- [GitHub Actions: actions/cache](https://github.com/actions/cache)
