# Requirements Document

## Project Description (Input)

obsidian-drawio プラグインの drawio-embed-bridge は iframe を `app://[hash]/<vault-absolute-path>/...drawio/index.html?embed=1&proto=json...` の URL で生成し、drawio webapp を読み込ませる。実機 E2E (automated-testing spec) で検証したところ、iframe の `index.html` は読み込まれるものの、相対参照されている **sub-resource (例: `js/main.js`、`js/bootstrap.js`、`styles/grapheditor.css`、`styles/high-contrast.css`、`images/spin.gif` など)** が Obsidian の `app://` プロトコルハンドラによって `ERR_BLOCKED_BY_CLIENT` で拒否され、drawio webapp の JavaScript bootstrap が走らない。結果として:

- iframe の DOM は drawio index.html の静的 HTML テキストのまま (本来 JS で置換されるはず)
- drawio webapp が embed mode で送るはずの `event: "init"` postMessage が parent window に届かない
- 上に積み上がる drawio-file-io / drawio-settings-and-config / drawio-external-sync の機能 (load / autosave / save / theme 追従 / external reload) も実機で動作しない

### 誰が困っているか

- プラグインユーザー: 実機で `.drawio` を開いても drawio エディタが起動せず、機能が利用できない (現状ユーザに plugin が release されていれば致命的)。
- E2E テスト: iframe 依存の 4 spec (`drawio-iframe-init` / `three-formats-roundtrip` / `theme-follow` / `external-sync-reload`) が全て fixme 状態で品質保証が成立しない。

### 現状

- `src/lib/drawio-bridge.ts` が `app.vault.adapter.getResourcePath(pluginDir + '/drawio/index.html')` で iframe の base URL を取得し、`<iframe sandbox="allow-scripts allow-same-origin allow-downloads" data-drawio src="...">` を生成する。
- iframe 内の drawio webapp は `index.html` から相対参照で `js/main.js` 等を取得しようとするが、Obsidian の `app://` 内部 webRequest フィルタ (推定) が `.obsidian/plugins/<id>/drawio/...` 配下の sub-resource アクセスを拒否する。
- `--disable-web-security` を Electron に渡しても拒否されるため、Chromium 標準の CORS / web security の問題ではなく Obsidian 独自のリソース許可ロジックによる制限と判断できる。
- automated-testing spec の Implementation Notes に問題状況と回避案 (file:// protocol、専用プロトコル、asset 同梱) を記録済。

### 何が変わるべきか

- drawio webapp の **すべての sub-resource (HTML / JS / CSS / 画像 / フォント)** が iframe からロード可能になり、drawio embed mode が正常に bootstrap して `init` postMessage を parent に送出する。
- ロード戦略は Obsidian Community Plugin の制約 (`innerHTML` 禁止 / 外部 CDN 禁止 / `onunload()` での完全 cleanup / Apache-2.0 ライセンスの正しい同梱) を遵守する。
- 既存の drawio-embed-bridge の API (`createDrawioBridge` / `mount` / `sendMessage` / postMessage プロトコル) は破壊変更しない (downstream の drawio-file-io / drawio-settings-and-config / drawio-external-sync が import している型と挙動を維持)。
- automated-testing spec で fixme 化されている 3 つの iframe 依存 E2E spec (`drawio-iframe-init` / `three-formats-roundtrip` / `external-sync-reload`) が `test.fixme` を解除して green になる状態を実現する。`theme-follow` の skip 解除は別タスク (UI セレクタの確定) なので本 spec のスコープ外。

### スコープ境界

- **In**:
  - drawio webapp resource serving のロード戦略再設計 (file:// / `registerProtocol` / asset 同梱 + dataURL / Service Worker など候補を比較し採択)
  - `src/lib/drawio-bridge.ts` の iframe URL 生成と sandbox 設定の更新
  - 必要なら `src/main.ts` でのプロトコル登録 / cleanup (Plugin lifecycle)
  - `vendor/drawio` の vendor 戦略変更 (build-time copy 先 / asar bundle / CSP 影響など)
  - automated-testing の iframe 依存 E2E spec を test.fixme 解除し実機 green に持っていく検証
- **Out**:
  - drawio webapp 内部 (vendor/drawio 自体) の改造
  - drawio webapp 内部のパレット / 図形操作などの深いシナリオ自動化
  - Mobile / Linux / Windows 対応
  - drawio-bridge の postMessage プロトコル契約の変更
  - theme-follow E2E spec の UI セレクタ確定 (別 follow-up)

詳細は automated-testing spec の Implementation Notes (タスク 7.2 配下) を参照。

## Introduction

本 spec は、Obsidian デスクトップ環境において drawio embed iframe が必要とする全 sub-resource (HTML / JS / CSS / 画像 / フォント) を確実にロード可能にし、drawio webapp が embed mode として正常に bootstrap する状態を実現することを目的とする。現状の `app://` プロトコル経由のサブリソース取得は Obsidian の内部リソース許可ロジックにより拒否され、iframe 内の JavaScript が起動しないため、上位の `.drawio` ファイル編集機能および iframe 依存 E2E が機能しない。本 spec は、drawio-embed-bridge の対外 API 契約を維持したままリソース配信戦略を再設計し、ユーザー実機での編集体験と E2E による品質保証の両方を成立させる。

## Boundary Context

- **In scope**:
  - drawio iframe の sub-resource (HTML / JS / CSS / 画像 / フォント すべて) の配信戦略の選定と実装
  - iframe ソース URL (および必要なら sandbox 属性) の決定が外部から観測する挙動に与える影響
  - Obsidian Community Plugin ガイドライン (innerHTML 禁止 / 外部 CDN 禁止 / `onunload()` での完全 cleanup / Apache-2.0 ライセンス同梱) に対する適合
  - drawio webapp アセットのプラグイン同梱 (vendor) 戦略のうち、ユーザー観測可能な側面 (初回ロード時間、配布物サイズの上限ポリシー、ライセンス表示)
  - automated-testing spec で fixme 化された iframe 依存 E2E (`drawio-iframe-init` / `three-formats-roundtrip` / `external-sync-reload`) を Obsidian デスクトップ macOS 環境で green にできること
- **Out of scope**:
  - drawio webapp 自体 (`vendor/drawio` 配下) のソース改変
  - Mobile / Linux / Windows プラットフォーム対応
  - drawio-embed-bridge の postMessage プロトコル契約の意味的変更
  - `theme-follow` E2E spec の UI セレクタ確定
  - drawio webapp 内部のパレット / 図形操作などの自動化シナリオ
- **Adjacent expectations**:
  - drawio-embed-bridge (`src/lib/drawio-bridge.ts`) が公開している `createDrawioBridge` / `mount` / `sendMessage` / postMessage イベント型は本 spec によって破壊変更されないことを前提に、drawio-file-io / drawio-settings-and-config / drawio-external-sync が継続して機能する。
  - automated-testing spec は本 spec の完了後に該当 E2E の `test.fixme` を解除して安定実行できることを期待する。
  - plugin-foundation の Plugin lifecycle (`onload` / `onunload`) と Obsidian Community Plugin ガイドラインに準拠した cleanup を本 spec の実装が遵守する。

## Requirements

### Requirement 1: drawio webapp サブリソースの配信成功

**Objective:** As an Obsidian デスクトップ ユーザー, I want `.drawio` ファイルを開いた際に drawio エディタが起動して操作可能になること, so that ノートに埋め込んだダイアグラムを実機で閲覧・編集できる。

#### Acceptance Criteria

1. When ユーザーが Obsidian デスクトップで `.drawio` ファイルを開いたとき, the drawio plugin shall iframe 内で drawio webapp の `index.html` および全サブリソース (JS / CSS / 画像 / フォント) を完全にロードする。
2. When drawio webapp の bootstrap が完了したとき, the drawio plugin shall iframe から parent window へ embed mode の `init` postMessage を到達させる。
3. If 任意のサブリソース取得が失敗したとき, the drawio plugin shall ユーザーが識別可能なエラー表示を行い、`onunload` 時に cleanup できる状態を維持する。
4. The drawio plugin shall drawio webapp が必要とする MIME type (HTML / JavaScript / CSS / PNG / GIF / SVG / WOFF など) を iframe 内で正しく解釈可能な形で配信する。

### Requirement 2: drawio-embed-bridge 公開 API の互換性維持

**Objective:** As 上位 spec (drawio-file-io / drawio-settings-and-config / drawio-external-sync) の実装者, I want drawio-embed-bridge の対外 API と postMessage プロトコルが本変更で破壊されないこと, so that 既存機能と既存テストが継続して動作する。

#### Acceptance Criteria

1. The drawio-embed-bridge shall `createDrawioBridge` / `mount` / `sendMessage` の関数シグネチャと戻り値型を本 spec 完了後も互換に保つ。
2. The drawio-embed-bridge shall parent ⇄ iframe 間の postMessage イベント (`init` を含む既存イベント名・ペイロード形状) の意味と契約を維持する。
3. When drawio-file-io / drawio-settings-and-config / drawio-external-sync の既存テストを再実行したとき, the drawio-embed-bridge shall 既存テストが API 互換性を理由に失敗しない状態を保つ。

### Requirement 3: Obsidian Community Plugin ガイドライン適合

**Objective:** As Obsidian Community Plugin としての配布責任者, I want リソース配信戦略が Obsidian Community Plugin ガイドラインを遵守していること, so that レビュー通過とユーザー環境での安全な動作が保証される。

#### Acceptance Criteria

1. The drawio plugin shall iframe マウントおよびリソース配信の実装で `innerHTML` への文字列代入によって DOM を構築しない。
2. The drawio plugin shall 実行時に外部 CDN や外部ホストから drawio webapp サブリソースを取得しない (すべてプラグイン同梱で完結する)。
3. When ユーザーがプラグインを無効化または Obsidian を終了したとき, the drawio plugin shall `onunload` の中でプロトコル登録 / DOM ノード / iframe / 補助 worker などの副作用を完全に解放する。
4. The drawio plugin shall 同梱した drawio webapp アセットに対する Apache-2.0 ライセンス表記とライセンスファイルを配布物に含める。

### Requirement 4: drawio webapp アセット同梱戦略

**Objective:** As プラグインのビルド・配布担当, I want drawio webapp アセットをプラグイン配布物として確実に届けられること, so that ユーザー環境にネットワーク依存なくエディタが動作する。

#### Acceptance Criteria

1. The drawio plugin build shall drawio webapp の実行に必要なすべてのサブリソースを配布物に含めて出力する。
2. When プラグイン配布物が Obsidian に展開されたとき, the drawio plugin shall ネットワーク接続なしで drawio エディタを起動できる。
3. The drawio plugin build shall 配布物に含めた drawio webapp アセットのバージョン (vendor 由来) を識別可能な形で配布物内に保持する。

### Requirement 5: iframe 依存 E2E の green 化

**Objective:** As automated-testing spec の品質保証担当, I want iframe 依存の E2E spec が安定して green 化できること, so that drawio iframe 統合の回帰を CI で検出できる。

#### Acceptance Criteria

1. When `drawio-iframe-init` E2E を Obsidian デスクトップ macOS 環境で実行したとき, the automated-testing harness shall `test.fixme` を解除した状態で当該テストを成功させる。
2. When `three-formats-roundtrip` E2E を Obsidian デスクトップ macOS 環境で実行したとき, the automated-testing harness shall `test.fixme` を解除した状態で当該テストを成功させる。
3. When `external-sync-reload` E2E を Obsidian デスクトップ macOS 環境で実行したとき, the automated-testing harness shall `test.fixme` を解除した状態で当該テストを成功させる。
4. The automated-testing harness shall `theme-follow` E2E の skip 解除を本 spec の合否判定対象に含めない。

### Requirement 6: ユーザー観測可能なエラー処理と起動性能

**Objective:** As Obsidian デスクトップ ユーザー, I want drawio エディタの起動失敗が黙って続かないこと, so that 問題発生時に状況を把握して対処できる。

#### Acceptance Criteria

1. If drawio webapp の bootstrap が一定時間内に `init` postMessage を返さなかったとき, the drawio plugin shall ユーザーが識別可能なエラー表示を行う。
2. While drawio webapp がロード中であるとき, the drawio plugin shall ユーザーに進行中であることが分かる表示状態を維持する。
3. When エラー表示が出ている状態でユーザーがファイルを閉じたとき, the drawio plugin shall iframe およびエラー表示に関連するリソースを残さず解放する。
