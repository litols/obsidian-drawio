# Requirements Document

## Introduction

obsidian-drawio プラグイン (実装済 5 spec: plugin-foundation / drawio-embed-bridge / drawio-file-io / drawio-settings-and-config / drawio-external-sync) に対し、回帰防止と Community Plugin 申請に向けた品質エビデンスを目的とする **自動テスト基盤** を導入する。本 spec は (1) vitest による Unit Test 基盤、(2) Playwright + Electron による E2E Test 基盤、(3) GitHub Actions による 2 段構成 (基本検証 job + E2E job) の CI Pipeline を提供し、Pull Request と main branch への push の双方で並列実行され、両 job が green になることを main merge の前提条件とする。

ローカルでは開発者が `pnpm test` / `pnpm e2e` を実行して同等の検証を行え、`pnpm e2e --ui` で Playwright Inspector による debug が可能であることを目指す。

## Boundary Context

- **In scope**:
  - vitest を用いた Unit Test 基盤と、各 spec の **純粋ロジック層** (XML 圧縮判定 / PNG zTXt encode・decode / SVG content 属性 read・write / postMessage envelope shape / settings migrate / external diff など) に対する代表テスト
  - Playwright + Electron を用いた E2E Test 基盤、`e2e-vault/` フィクスチャ、各 spec の代表ユーザシナリオに対する E2E spec
  - GitHub Actions workflow (基本検証 job + E2E job、PR と main push の両方で発火)
  - 開発者向け README (Unit / E2E 実行手順、前提条件)
- **Out of scope**:
  - Mobile / Linux / Windows での E2E 実行
  - drawio webapp 内部のパレット操作・図形追加・編集ツール挙動など深いシナリオ
  - Visual regression (スクリーンショット差分)
  - 100% コードカバレッジ目標、obsidian API に直接触れる箇所への Unit Test
  - 既存 5 spec の実装に対する大規模 refactor
  - Community Plugin Registry への自動申請、GitHub branch protection ルール設定
- **Adjacent expectations**:
  - **既存 5 spec**: 本 spec の検証対象。本 spec は既存 spec の API / 振る舞いを変更しない (E2E / Unit で発覚した不具合は別 spec の修正として切り出す)。
  - **vendor/drawio submodule**: ローカル / CI 双方で初期化済 (`git submodule update --init --recursive`) であることを前提。
  - **Obsidian Electron アプリ**: ローカルでは `/Applications/Obsidian.app`、CI では GitHub Releases (obsidianmd/obsidian-releases) から取得した `.dmg` を使用。
  - **pnpm**: lockfile (`pnpm-lock.yaml`) に従ったパッケージマネージャ前提。

## Requirements

### Requirement 1: Unit Test 基盤 (vitest)

**Objective:** プラグイン開発者として、純粋ロジック層を高速に検証できる Unit Test 基盤を持ちたい。これにより、refactor や仕様変更時の回帰を build より早い段階で検出できる。

#### Acceptance Criteria

1. When 開発者がリポジトリ root で `pnpm test` を実行したとき, the Unit Test Suite shall 登録された全ての test ファイルを 1 回実行し、結果を pass / fail で標準出力に表示し、失敗時は非ゼロ終了コードを返す。
2. When 開発者がリポジトリ root で `pnpm test:watch` を実行したとき, the Unit Test Suite shall ファイル変更を監視して関連 test を再実行する watch モードで起動する。
3. The Unit Test Suite shall `src/**/*.test.ts` および `src/**/*.spec.ts` パターンにマッチするファイルを test 対象として認識する。
4. If test 対象のコードが obsidian package、`vendor/drawio` 配下、または Electron 固有 API に直接依存しているとき, the Unit Test Suite shall mock または import 回避によって test を実行可能とし、それらの実依存を立ち上げない。
5. The Unit Test Suite shall 既存の `pnpm build` (tsc + vite) と独立して動作し、build 成果物 (`dist/main.js`) の存在に依存せず実行できる。

### Requirement 2: Unit Test カバレッジ (代表ロジック)

**Objective:** プラグイン開発者として、各 spec の中核となる純粋ロジック層を unit test で覆いたい。これにより、binary 形式・プロトコル契約・設定マイグレーションのミスを CI で早期検出できる。

#### Acceptance Criteria

1. The Unit Test Suite shall `drawio-file-io` の XML 圧縮判定 / encode・decode について、平文 XML と pako 圧縮 XML 双方が round trip しても保持されることを検証する test を含む。
2. The Unit Test Suite shall `drawio-file-io` の PNG zTXt mxfile チャンク encode / decode について、エンコード後にデコードして元の mxfile XML が復元されることを検証する test を含む。
3. The Unit Test Suite shall `drawio-file-io` の SVG content 属性 / `<mxfile>` 子要素の read・write について、読み出した mxfile を書き戻したときに同等の SVG が生成されることを検証する test を含む。
4. The Unit Test Suite shall `drawio-embed-bridge` の postMessage envelope (`load` / `autosave` / `save` / `export` / `exit` などホスト ↔ iframe 間メッセージ) について、shape と必須フィールドが定義された型契約に従うことを検証する test を含む。
5. The Unit Test Suite shall `drawio-settings-and-config` の `migrateSettings` について、旧スキーマからの変換結果が現行スキーマの期待値と一致することを検証する test を含む。
6. The Unit Test Suite shall `drawio-external-sync` の diff / 衝突判定について、(外部変更あり / なし) × (ローカル dirty / clean) の組み合わせごとに期待される結果 (auto reload 可 / user prompt 必要 / 無視) が返ることを検証する test を含む。
7. If 検証対象のロジックが obsidian API に直接依存していて mock コストが過大なとき, the Unit Test Suite shall そのコードを Unit Test 対象外とし、E2E でのカバー方針を README に記録する。

### Requirement 3: E2E Test 基盤 (Playwright + Obsidian Electron)

**Objective:** プラグイン開発者として、Obsidian を実際に起動した状態でプラグインの統合動作を検証したい。これにより、postMessage handshake や Vault 連動など実機でしか再現できない振る舞いを回帰検出できる。

#### Acceptance Criteria

1. When 開発者がローカルで `pnpm e2e:setup` を初回実行したとき, the E2E Test Suite shall ローカル `/Applications/Obsidian.app` から Obsidian バイナリを抽出し `.obsidian-unpacked/` 配下に展開し、フィクスチャ vault の trust author ダイアログを突破した状態を保存する。
2. When CI で `pnpm e2e:setup` が `--ci` 相当のフラグ付きで実行されたとき, the E2E Test Suite shall GitHub Releases (`obsidianmd/obsidian-releases`) から固定バージョンの Obsidian `.dmg` を取得して同様に抽出する。
3. When 開発者または CI が `pnpm e2e` を実行したとき, the E2E Test Suite shall ビルド済プラグイン成果物 (`main.js` / `manifest.json` / `styles.css`) を `e2e-vault/.obsidian/plugins/<plugin-id>/` 配下に配置 (symlink 可) し、Playwright 経由で Obsidian Electron を起動する。
4. The E2E Test Suite shall `e2e-vault/` フィクスチャを repo に commit し、サンプル `.drawio` / `.drawio.svg` / `.drawio.png` ファイルと `.obsidian/community-plugins.json` (プラグイン ID 事前登録) を含む。
5. While drawio iframe が表示されている状態で, the E2E Test Suite shall iframe 内 DOM への参照を取得して操作 / アサーションできる API を提供する。
6. When 開発者が `pnpm e2e --ui` を実行したとき, the E2E Test Suite shall Playwright Inspector / UI モードを起動し、ステップ実行による debug を可能にする。
7. If `vendor/drawio` submodule または build 成果物が未準備の状態で `pnpm e2e` が実行されたとき, the E2E Test Suite shall 起動前に不足を検出し、不足項目を明示するエラーメッセージで非ゼロ終了する。
8. When 開発者が `pnpm e2e:cleanup` を実行したとき, the E2E Test Suite shall フィクスチャ vault の workspace.json などテスト実行で汚染される一時状態を初期状態にリセットする。

### Requirement 4: E2E テストシナリオ (代表ユーザフロー)

**Objective:** プラグイン開発者として、各 spec の代表ユーザシナリオが実機 Obsidian で end-to-end に成功することを CI で確認したい。これにより、機能横断の regression を main merge 前に検出できる。

#### Acceptance Criteria

1. The E2E Test Suite shall プラグイン有効化シナリオを含み、Obsidian 起動後にプラグインがロードされ、設定タブが Obsidian 設定画面に表示されることを検証する。
2. When `e2e-vault/` 内の `.drawio` ファイルが開かれたとき, the E2E Test Suite shall drawio iframe が初期化され、host ↔ iframe 間の `init` / `load` 系 postMessage がやり取りされることを検証する。
3. The E2E Test Suite shall 3 形式 (`.drawio` / `.drawio.svg` / `.drawio.png`) それぞれについて、エディタで開いて iframe にロードされ、編集 → 保存後にファイル内容が更新されることを検証するシナリオを含む。
4. When プラグイン設定 UI でテーマが light → dark に切り替えられたとき, the E2E Test Suite shall drawio iframe のテーマが追従することを検証する。
5. When E2E 実行中にプラグインの外部から `e2e-vault/` 内の `.drawio` ファイルが書き換えられたとき, the E2E Test Suite shall reload バナー / Notice の表示を検証し、ユーザによる reload 採用 / 却下フローを再現する。
6. If E2E シナリオが timeout または失敗したとき, the E2E Test Suite shall 失敗時のスクリーンショットおよび Playwright trace を artifact として保存できる構成にする。

### Requirement 5: CI Pipeline (GitHub Actions)

**Objective:** 全コントリビュータとして、PR ごと・main push ごとに自動テストが必須 gate として実行されることを期待する。これにより、main branch の品質が継続的に保証される。

#### Acceptance Criteria

1. When Pull Request が作成または更新されたとき, the CI Pipeline shall 基本検証 job と E2E job を並列で実行する。
2. When commit が main branch に push されたとき, the CI Pipeline shall 基本検証 job と E2E job を並列で実行する。
3. The CI Pipeline shall 基本検証 job を ubuntu-latest runner で実行し、`pnpm install`、`pnpm lint`、`pnpm format:check`、`pnpm test`、`pnpm build` を依存順で実行する。
4. The CI Pipeline shall E2E job を macos-latest runner で実行し、`vendor/drawio` submodule init、Obsidian バイナリ抽出、`pnpm e2e:setup`、`pnpm e2e` を依存順で実行する。
5. If 基本検証 job または E2E job のいずれかが fail したとき, the CI Pipeline shall workflow 全体のステータスを fail として GitHub に報告する。
6. The CI Pipeline shall 基本検証 job と E2E job のステータスを GitHub Checks に独立して公開し、PR レビュアーがどちらが落ちたかを区別できるようにする。
7. The CI Pipeline shall pnpm cache および Obsidian バイナリ抽出結果のキャッシュ機構を備え、再実行時の総所要時間を短縮する。
8. While E2E job が実行されているあいだ, the CI Pipeline shall 失敗時に Playwright trace、screenshot、Obsidian 起動ログを workflow artifact としてアップロードする。

### Requirement 6: 開発者体験 (ローカル実行 / ドキュメント)

**Objective:** プラグイン開発者として、ローカルでテストを実行する手順が一貫しており、debug が可能であることを期待する。

#### Acceptance Criteria

1. The Automated Testing Infrastructure shall README にローカルでの Unit Test 実行手順 (`pnpm test` / `pnpm test:watch`) を明記する。
2. The Automated Testing Infrastructure shall README にローカルでの E2E 実行手順 (前提となる `/Applications/Obsidian.app` の存在、`vendor/drawio` submodule 初期化、`pnpm e2e:setup` → `pnpm e2e` の順序) を明記する。
3. The Automated Testing Infrastructure shall `package.json` の scripts に `test`、`test:watch`、`e2e:setup`、`e2e:cleanup`、`e2e` を全て登録する。
4. If 開発者環境で前提 (Obsidian.app の存在、submodule 初期化、pnpm) が満たされていないとき, the Automated Testing Infrastructure shall setup スクリプトが具体的な不足項目を指摘するエラーメッセージで非ゼロ終了する。

### Requirement 7: 範囲外境界の明示

**Objective:** プロジェクト全体として、本 spec のスコープ外を要件として明示し、想定外の範囲拡大を防ぐ。

#### Acceptance Criteria

1. The Automated Testing Infrastructure shall E2E 実行のサポート対象 OS を macOS のみとし、Linux / Windows を本 spec のスコープ外として README に明記する。
2. The Automated Testing Infrastructure shall drawio webapp 内部のパレット操作・図形追加など深いシナリオを Out of scope として README に明記する。
3. The Automated Testing Infrastructure shall obsidian API に直接依存するコードを Unit Test 対象外として README に明記し、E2E でのカバーに委ねる方針を示す。
4. The Automated Testing Infrastructure shall 既存 5 spec の API および振る舞いを変更しない。Unit Test / E2E 実装中に発覚した不具合は別 spec の修正として切り出す。
