# Implementation Plan

## 1. Foundation: パッケージ・設定基盤

- [x] 1.1 test 関連 scripts と devDependencies の追加
  - `package.json` に `test`、`test:watch`、`e2e:setup`、`e2e:cleanup`、`e2e` の 5 scripts を登録
  - devDependencies に `vitest`、`@playwright/test`、`electron`、`@electron/asar` を追加 (バージョンは設計で指定したレンジ)
  - `pnpm install --frozen-lockfile` が成功し、`pnpm-lock.yaml` が更新された状態を確認できる
  - _Requirements: 1.1, 1.2, 6.3_

- [x] 1.2 vitest 設定の構築
  - `vitest.config.ts` を新規作成し、既存 `vite.config.ts` を `mergeConfig` で再利用する
  - `test.environment: 'node'`、`test.include: ['src/**/*.{test,spec}.ts']` を設定
  - `vite-plugin-static-copy` 等のビルド専用 plugin が test 実行時に副作用を出さないよう plugin 配列をフィルタする処理を含める
  - 検証用の最小ダミーテストを 1 件配置し、`pnpm test` がそのテストのみ pass で完走することを確認できる (この検証用ダミーは 1.4 の手前で削除)
  - _Requirements: 1.3, 1.4, 1.5_

- [x] 1.3 test artifact 用 gitignore とリポジトリレイアウト整備
  - `.gitignore` に `.obsidian-unpacked/`、`playwright-report/`、`test-results/`、`coverage/`、`e2e-vault/.obsidian/workspace.json` を追加
  - `tests/` ディレクトリ (`tests/e2e-setup/`、`tests/e2e/`、`tests/helpers/`) と `scripts/` ディレクトリの空構造を git に登録 (各サブディレクトリに `.gitkeep` 等)
  - `git status` 上で test artifact 系ファイルが untracked にならないことを確認できる
  - _Requirements: 3.1, 3.8, 4.6_

- [x] 1.4 フィクスチャ vault の構築
  - `e2e-vault/.obsidian/` 配下に `community-plugins.json` (プラグイン id 事前登録)、`core-plugins.json`、`app.json` (trust 済状態)、`appearance.json` を配置
  - `e2e-vault/samples/` に `empty.drawio` (平文 mxfile)、`compressed.drawio` (pako 圧縮 mxfile)、`sample.drawio.svg` (`content` 属性付き)、`sample.drawio.png` (zTXt mxfile 付き) を作成して commit
  - `e2e-vault/README.md` にフィクスチャ更新ルールを記載
  - サンプルが Obsidian で開ける状態になっていることを手元で確認 (smoke check) し、ファイルバイト列を確定する
  - _Requirements: 3.4_

- [x] 1.5 Obsidian バイナリ抽出スクリプトの実装
  - `scripts/setup-obsidian.sh` で local モード (`/Applications/Obsidian.app` から抽出) と `--ci` モード (`gh release download` で `obsidianmd/obsidian-releases` から `.dmg` 取得 + 抽出) を分岐実装
  - `npx @electron/asar extract` で `app.asar` を `.obsidian-unpacked/` に展開、`obsidian.asar` も同階層へコピー
  - `gh` CLI 不在 / `Obsidian.app` 不在 / `OBSIDIAN_VERSION` 未設定 等の前提不足を検出して具体的不足項目を含めたエラーメッセージで非ゼロ終了する
  - 実行後に `.obsidian-unpacked/main.js` が存在することを確認できる
  - _Requirements: 3.1, 3.2, 3.7, 6.4_

- [x] 1.6 Playwright 設定の構築
  - `playwright.config.ts` で `e2e-setup` と `e2e` の 2 project を定義し、`fullyParallel: false`、`timeout: 300s`、`use.trace: 'on-first-retry'`、`use.screenshot: 'only-on-failure'` を指定
  - `globalSetup` または `e2e-setup` project 内で `dist/main.js` と `vendor/drawio` の存在を assert し、未準備時は明示エラーで停止する preflight を組み込む
  - `pnpm e2e --ui` で Playwright Inspector が起動し、project セレクタが表示されることを確認できる
  - _Requirements: 3.6, 3.7, 4.6_

## 2. Unit Tests: 純粋ロジック層の検証

- [x] 2.1 (P) drawio XML 圧縮判定の round trip テスト
  - 平文 mxfile / `<mxfile><diagram>...base64...</diagram>` 形式の双方を read で正しく分類し、write で逆変換できる境界ケースを網羅する
  - 不正データ・空文字列・長大データに対するフォールバック挙動を明示的に検証
  - `pnpm test src/lib/drawio-formats/drawio-xml.test.ts` で全ケース pass する
  - _Requirements: 2.1_
  - _Boundary: drawio-xml_

- [x] 2.2 (P) drawio PNG zTXt mxfile チャンクの round trip テスト
  - サンプル PNG (`e2e-vault/samples/sample.drawio.png`) を decode して mxfile を取得、再 encode してから decode しても同一 mxfile が得られることを検証
  - tEXt と zTXt の両方の経路、mxfile チャンク不在時のフォールバックを網羅
  - `pnpm test src/lib/drawio-formats/drawio-png.test.ts` で全ケース pass する
  - _Requirements: 2.2_
  - _Boundary: drawio-png_

- [x] 2.3 (P) drawio SVG content 属性 / `<mxfile>` 子要素の read-write テスト
  - `content` 属性 (base64 mxfile) と `<mxfile>` 子要素の双方からの読み出しケースを検証
  - 書き戻し後の SVG が再 read で同等の mxfile を返すことを確認
  - `pnpm test src/lib/drawio-formats/drawio-svg.test.ts` で全ケース pass する
  - _Requirements: 2.3_
  - _Boundary: drawio-svg_

- [x] 2.4 (P) postMessage envelope shape のテスト
  - `DrawioInbound*` (`load`/`autosave`/`save`/`export`/`exit`) と `DrawioOutbound*` (`load`/`merge`/`configure`/`export`) の各メッセージが、必須フィールドと型契約に従うことを runtime レベルで検証
  - 不正 shape の入力に対して型ガードが false を返すこと
  - `pnpm test src/lib/drawio-protocol.test.ts` で全ケース pass する
  - _Requirements: 2.4_
  - _Boundary: drawio-protocol_

- [x] 2.5 (P) settings の `migrateSettings` テスト
  - legacy トップレベル (`openDrawioSvg` / `openDrawioPng` / `preserveCompression`) を含む旧スキーマ入力が `drawio.*` 名前空間配下へ正しく移行することを検証
  - `null` / `undefined` / 空オブジェクト / 不正型などの境界入力に対するデフォルト値適用を網羅
  - `pnpm test src/lib/settings.test.ts` で全ケース pass する
  - _Requirements: 2.5_
  - _Boundary: settings_

- [x] 2.6 (P) theme-bridge `resolveBridgeTheme` テスト
  - `auto` / `light` / `dark` / `kennedy` / `min` / `atlas` の各設定値と Obsidian 現在テーマの組み合わせに対する期待戻り値を検証
  - `pnpm test src/lib/theme-bridge.test.ts` で全ケース pass する
  - _Requirements: 2.6_
  - _Boundary: theme-bridge_

- [x] 2.7 (P) external-watcher 純粋判定部のテスト
  - echo suppression (recent self-write の TTL 比較) と debounce (mtime / 経過時間判定) の純粋関数を unit test で検証
  - `external-watcher.ts` 本体の API 変更が必要な場合、最小限の `__test__` 名前空間 export または既存 export の再構成のみに留め、`Plugin.events` への配線等の振る舞いは変更しない
  - `pnpm test src/lib/external-watcher.test.ts` で全ケース pass し、`src/main.ts` 側からの呼び出しが破綻していないことを `pnpm build` で確認できる
  - _Requirements: 2.6, 2.7, 7.4_
  - _Boundary: external-watcher_

## 3. E2E Helpers: 共通基盤

- [x] 3.1 (P) Obsidian launch helper の実装
  - Playwright `_electron.launch()` のラッパ関数を提供し、抽出済 `.obsidian-unpacked/main.js` を `args[0]` に渡して `e2e-vault/` を URL 経由で開く
  - 起動前に `Obsidian.app` 抽出物の存在を assert し、不在時は具体的不足項目を含めたエラーで非ゼロ終了する preflight を実装
  - 単発 sanity test で「起動 → main window が attach される」ことを確認できる
  - _Requirements: 3.1, 3.7, 6.4_
  - _Boundary: obsidian-launch helper_

- [ ] 3.2 (P) Plugin install helper の実装
  - `dist/main.js`、`dist/manifest.json`、`dist/styles.css`、`dist/drawio/` を `e2e-vault/.obsidian/plugins/obsidian-drawio/` へ symlink (or copy フォールバック) で配置
  - `dist/` 不在時は明示エラーで停止
  - 配置後に `e2e-vault/.obsidian/plugins/obsidian-drawio/manifest.json` が解決可能であることを確認できる
  - _Requirements: 3.3, 3.7_
  - _Boundary: plugin-install helper_

- [ ] 3.3 (P) drawio frame helper の実装
  - Playwright `frameLocator` で drawio iframe を取得するラッパと、`waitForReady(timeoutMs)` (DOM 要素出現 AND `init` postMessage 履歴の両条件) を実装
  - `page.evaluate` で `window.addEventListener('message', ...)` を仕込み、テスト側から受信履歴を取得できる API を提供
  - timeout 失敗時は iframe URL と受信メッセージ件数を含めた診断メッセージを投げる
  - 単発 sanity test で「`.drawio` を開いた直後に `waitForReady` が解決する」ことを確認できる
  - _Requirements: 3.5, 4.2_
  - _Boundary: drawio-frame helper_

- [ ] 3.4 (P) Vault FS helper の実装
  - `e2e-vault/samples/` のサンプルを read する API、および外部変更をシミュレートする write API を提供
  - 外部書き込み API は `external-watcher` の echo suppression を確実に回避するため、書き込み前に suppression TTL を超える sleep を挟む
  - `node:fs` ベースで実装し、Playwright runtime とは独立に呼び出せる
  - 単発 sanity test で「サンプル read で期待 mxfile が取得できる」「外部 write 後にファイル mtime が更新される」ことを確認できる
  - _Requirements: 4.3, 4.5_
  - _Boundary: vault-fs helper_

## 4. E2E Setup と Cleanup

- [ ] 4.1 e2e-setup project の実装
  - `tests/e2e-setup/setup.ts` で Obsidian launch helper + plugin install helper を呼び、初回起動時の trust author ダイアログを Playwright UI 操作で突破する
  - 突破後の `e2e-vault/.obsidian/workspace.json` 等を保存して以降の `e2e` project が再表示なしで起動できる状態を作る
  - `pnpm e2e:setup` 実行で、最終状態の workspace.json が生成されることを確認できる
  - _Requirements: 3.1, 3.3, 6.4_
  - _Depends: 3.1, 3.2_

- [ ] 4.2 e2e-cleanup スクリプトの実装
  - `tests/e2e-setup/cleanup.ts` で `e2e-vault/.obsidian/workspace.json` 等の実行時生成物を初期状態にリセット
  - `pnpm e2e:cleanup` 実行後に `git status -- e2e-vault/.obsidian/` が clean となることを確認できる
  - _Requirements: 3.8_

## 5. E2E Specs: 各 spec の代表ユーザシナリオ

- [ ] 5.1 (P) プラグイン有効化シナリオ
  - Obsidian 起動 → プラグインがロード → 設定タブに drawio 項目が表示されることを検証
  - `pnpm e2e --grep plugin-activation` で当該 spec のみが pass する
  - _Requirements: 4.1_
  - _Boundary: plugin-activation.spec_
  - _Depends: 4.1_

- [ ] 5.2 (P) drawio iframe init シナリオ
  - 空 `.drawio` ファイルを開く → iframe init / load 系 postMessage が host ↔ iframe 間でやり取りされることを drawio frame helper の受信履歴で検証
  - `pnpm e2e --grep drawio-iframe-init` で当該 spec のみが pass する
  - _Requirements: 4.2_
  - _Boundary: drawio-iframe-init.spec_
  - _Depends: 4.1_

- [ ] 5.3 (P) 3 形式 round trip シナリオ
  - `.drawio` / `.drawio.svg` / `.drawio.png` の各サンプルを順に開く → iframe load 確認 → ダーティ操作 → 保存 → ファイル内容更新を検証
  - 各形式について「保存前後でファイルバイト列が変化」「再 read した mxfile が直前の編集を反映」を確認
  - `pnpm e2e --grep three-formats-roundtrip` で当該 spec が pass する
  - _Requirements: 4.3_
  - _Boundary: three-formats-roundtrip.spec_
  - _Depends: 4.1_

- [ ] 5.4 (P) テーマ追従シナリオ
  - 設定タブで theme を `light` → `dark` に切替 → drawio iframe へ `configure` action または theme 反映が伝播することを検証
  - `pnpm e2e --grep theme-follow` で当該 spec が pass する
  - _Requirements: 4.4_
  - _Boundary: theme-follow.spec_
  - _Depends: 4.1_

- [ ] 5.5 (P) 外部変更 reload シナリオ
  - `.drawio` を開いた状態で vault FS helper から外部書き込み → reload バナー / Notice の表示を検証
  - reload 採用ボタン押下で iframe が新しい mxfile に更新されること、却下では更新されないことの双方を検証
  - `pnpm e2e --grep external-sync-reload` で当該 spec が pass する
  - _Requirements: 4.5_
  - _Boundary: external-sync-reload.spec_
  - _Depends: 4.1_

## 6. CI Pipeline

- [ ] 6.1 GitHub Actions workflow の実装
  - `.github/workflows/ci.yml` を新規作成し、`on: pull_request` と `on: push: branches: [main]` の両方で発火
  - jobs を 2 段並列構成 (`basic` on ubuntu-latest、`e2e` on macos-latest) とし、`needs` で連結しない (独立 Check になる)
  - basic job: `actions/checkout` (submodules: recursive) → `pnpm/action-setup` → `pnpm install` → `pnpm lint` → `pnpm format:check` → `pnpm test` → `pnpm build` の順
  - e2e job: checkout → pnpm setup → install → `bash scripts/setup-obsidian.sh --ci` → `pnpm build` → `pnpm e2e:setup` → `pnpm e2e`
  - `actions/cache` で pnpm store と `.obsidian-unpacked/` をキャッシュ (key に `OBSIDIAN_VERSION` env を含める)
  - e2e job 失敗時のみ `actions/upload-artifact` で `playwright-report/`、`test-results/`、Obsidian 起動ログを保存
  - `env.OBSIDIAN_VERSION` で Obsidian バージョンを固定 pin
  - branch に push して GitHub Checks に basic / e2e の独立ステータスが表示されることを確認できる
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

## 7. ドキュメント整備と最終統合検証

- [ ] 7.1 README Testing セクションの追加
  - Unit Test 実行手順 (`pnpm test` / `pnpm test:watch`) を明記
  - E2E 実行手順 (前提となる `/Applications/Obsidian.app` の存在、`vendor/drawio` submodule 初期化、`pnpm e2e:setup` → `pnpm e2e` の順序、`pnpm e2e --ui` での debug) を明記
  - サポート対象 OS (E2E は macOS のみ)、drawio webapp 内部操作の Out of scope、obsidian API 直依存ロジックを Unit 対象外として E2E に委譲する方針を記載
  - branch protection で `basic` / `e2e` を required check にする運用手順 (リポジトリ管理者向け) を記載
  - 該当セクションが追加された README が手元で読める
  - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.3_

- [ ] 7.2 ローカルおよび CI でのフルパス検証
  - クリーン clone から `pnpm install` → `bash scripts/setup-obsidian.sh` → `pnpm build` → `pnpm e2e:setup` → `pnpm test` と `pnpm e2e` をローカル macOS で全て green まで通す
  - `pnpm test` / `pnpm e2e` 双方で全 spec が pass し、`pnpm e2e:cleanup` で `e2e-vault/.obsidian/` が初期状態に戻ることを確認
  - feature branch に push して GitHub Actions の `basic` / `e2e` 両 job が green になることを確認
  - 既存 5 spec の振る舞いに影響が出ていないことを `pnpm build` の typecheck と E2E spec のすべての pass で担保 (Req 7.4)
  - _Requirements: 1.1, 3.1, 3.3, 5.1, 5.2, 6.1, 6.2, 7.4_
  - _Depends: 6.1, 7.1_

## Implementation Notes

- 1.4: e2e-vault/samples/sample.drawio.png は tEXt チャンクで mxfile を埋め込み (zTXt の代わり)。drawio-png reader は両対応のため fixture 機能としては問題ない。task 2.2 (PNG unit test) で zTXt 用テストデータはインラインで別途生成すること。
- 2.1: `readDrawioXml` は入力が `<mxfile>` プレフィックスを持つと早期 return で `compressed: false` を返すため、`writeDrawioXml(xml, true)` で生成した値を再 read しても圧縮 flag が保持されない (現実装仕様)。drawio-file-io spec のロジック側の課題として upstream にフィードバックするか別 spec で fix を切り出す必要あり。本 spec ではテストで現挙動を pin down している。
- 2.5/2.6/2.7: `import type { Plugin } from "obsidian"` を持つモジュールを test から import すると、verbatimModuleSyntax + Vite 解決で `obsidian` (main:"") を実体ロードしようとして失敗する。`vitest.config.ts` に `stub-obsidian` plugin を追加し、空 module を返す形で回避。task 2.5 で初導入、後続 test も同 plugin を共有。
- 2.7: `external-watcher.ts` から `isDrawioFile` を export 公開、`isSelfWriteSuppressed` を新規 export 追加 (echo suppression の純粋判定部抽出)。本体振る舞いは不変、テスト容易性のための最小 surface 拡張のみ (Req 7.4 準拠)。
