# Research & Design Decisions — drawio-preview-mode

## Summary
- **Feature**: `drawio-preview-mode`
- **Discovery Scope**: Extension (既存 DrawioView / drawio-bridge / asset-loader への拡張)
- **Key Findings**:
  - 現行実装はファイルを開くたびに `dist/drawio` 配下 **149MB / 3,342 ファイル**を再帰読み込みし、base64 エンコードのうえ iframe へ JSON 文字列として postMessage している (キャッシュなし)
  - `viewer-static.min.js` (約 3.6MB, GraphViewer + shapes 同梱) が dist/drawio に既に含まれており、軽量プレビューに利用可能
  - bootstrap HTML は object 形式の postMessage を既に受理できるため、configure ペイロードの structured clone 化は frame-messenger の小改修のみで実現できる

## Research Log

### 現行のアセット読み込みフロー
- **Context**: パフォーマンス改善の起点特定
- **Sources Consulted**: `src/lib/drawio-bridge.ts`, `src/lib/drawio-asset-loader.ts`, `src/iframe/init/request-manager.ts`, `src/iframe/init/index.ts`
- **Findings**:
  - `DrawioBridge.mount()` が毎回 `createDrawioAssetLoader().loadAll()` を実行 (`drawio-bridge.ts:445-463`)。`loadAll()` は `dist/drawio` 配下を全ファイル再帰列挙し、テキストはそのまま、バイナリは base64 化して `responses` テーブルを構築 (`drawio-asset-loader.ts:117-176`)
  - `responses` は `{action:"configure"}` として **JSON.stringify で文字列化して** iframe へ postMessage (`drawio-bridge.ts:278-285`)。iframe 側 frame-messenger が JSON.parse (`frame-messenger.ts:85`)。約 150MB 級の stringify/parse が毎マウント発生
  - iframe 内 request-manager は patched setAttribute / XHR open の**同期解決**を前提とするため、全アセット事前供給が必要 (オンデマンド非同期供給への変更は大規模改造になる)
  - `app.min.js` (8.9MB) のパース + EditorUi 構築で冷間起動 5 秒超 (`drawio-bridge.ts:84-87` の実測コメント)
- **Implications**: 改善は (1) 読み込み結果のセッションキャッシュ、(2) アセットセット削減、(3) stringify/parse 排除の 3 点が低リスク・高効果。オンデマンド供給プロトコルは本 spec のスコープ外 (将来課題)

### dist/drawio のサイズ内訳と削減候補
- **Context**: アセットセット削減の安全な対象特定
- **Sources Consulted**: `du -sm dist/drawio/*`
- **Findings**: js/ 66MB (うち `integrate.min.js` 22MB, `app.min.js` 9MB, `stencils.min.js` 8MB, `viewer-static.min.js` 4MB, `viewer.min.js` 3MB), stencils/ 41MB, img/ 12MB, images/ 7MB, WEB-INF/ 6MB, templates/ 6MB, resources/ 5MB, mxgraph/ 4MB, math4/ 4MB, shapes/ 3MB
- **Implications**: エディタ実行に不要と断定できるもの: `js/integrate.min.js` (Teams 統合用), `js/viewer.min.js` / `js/viewer-static.min.js` (エディタ iframe では未使用), `service-worker.js*` / `workbox-*` (SW は sandbox iframe で無効), `META-INF/` / `WEB-INF/` (サーバ設定), `connect/` (SaaS 連携), `*.map`。合計約 35-40MB 削減見込み。request-manager は未解決 URL を warn + passthrough で優雅に劣化するため、過剰除外時も起動不能にはならない

### GraphViewer (viewer-static.min.js) の API
- **Context**: XML プレビューのレンダリング手段の実在確認
- **Sources Consulted**: `vendor/drawio/src/main/webapp/js/diagramly/GraphViewer.js`
- **Findings**:
  - `GraphViewer.createViewerForElement(element)` — `data-mxgraph` 属性の JSON config (xml, toolbar 等) で viewer を生成 (GraphViewer.js:2634)
  - `graphConfig.toolbar` はスペース区切りトークン: `pages` / `zoom` / `layers` / `lightbox` (GraphViewer.js:166-171, 1585-1855)。ツールバー画像は Editor.*Image の data URI を使うためオフラインで動作
  - `GraphViewer.prototype.setXmlNode` で再ロード可能 (GraphViewer.js:875)。ズームは toolbar `zoom` トークンで組み込み提供
  - viewer-static は shapes / stencils を静的同梱した自己完結ビルド
- **Implications**: 独自ズームプロトコルを作らず GraphViewer 組み込み toolbar (`pages zoom layers`) を使うのが最小リスク。外部変更時は iframe 再マウント (viewer は軽量なので再起動コスト小) で十分

### bootstrap / messenger の structured clone 受け入れ可否
- **Context**: 150MB 級 JSON stringify/parse の排除可否
- **Sources Consulted**: `src/lib/drawio-bootstrap-html.ts:38`, `src/iframe/init/frame-messenger.ts:85`
- **Findings**: bootstrap HTML の message リスナは `typeof e.data === "string" ? JSON.parse(e.data) : e.data` で既にオブジェクトを受理。frame-messenger のみ `JSON.parse(event.data as string)` で文字列前提
- **Implications**: frame-messenger を同じ typeof 判定に改修すれば、親→iframe の configure をオブジェクトのまま postMessage (structured clone) でき、巨大 JSON の stringify/parse を両側で排除できる。iframe→親 (drawio protocol) は従来どおり JSON 文字列のまま

### ハイブリッドプレビューのフォーマット別戦略
- **Context**: `.drawio.svg` / `.drawio.png` はレンダリング済み画像を内包する
- **Sources Consulted**: `src/lib/drawio-formats/` (readDrawioFile は format 判定と XML 抽出を提供), main.ts の file-open ハンドリング
- **Findings**: svg/png のエクスポート画像は**現在ページのみ**をレンダリングしたもの。複数ページの XML を内包していても画像は 1 ページ分
- **Implications**: svg/png でも `<diagram>` 要素が 2 つ以上ある場合は GraphViewer 経路へフォールバックしないと要件 2.4 (ページ切替) を満たせない。戦略選択関数 `selectPreviewStrategy(format, xml)` を純関数として切り出しユニットテスト対象にする

### teammate 調査による追加知見 (explore-loading / explore-specs)
- **Context**: 並行調査エージェントのレポート統合
- **Findings**:
  - viewer-static.min.js は mxClient/mxGraph (v29.7.12) 内包の自己完結バンドル。前提グローバル (`mxLoadResources=false`, `isLocalStorage=false`, `urlParams`, localStorage/cookie stub) は既存 `frame-globals.ts` の installFrameGlobals で充足済み。**不足は `window.DRAWIO_BASE_URL` のみ**
  - GraphViewer の graphConfig には `auto-fit` (初期フィット), `toolbar-nohide`, `dark-mode` 等のキーがある
  - `.drawio.svg` / `.drawio.png` は **`vault.getResourcePath(file)` を `<img src>` に直接指定**すれば内容読込も Blob URL 管理も不要 (URL にバージョンクエリが付くため外部変更時は src 差し替えのみで更新)
  - 拡張 stencil セット (aws 等) は viewer-static 同梱外で遅延 XHR される。viewer iframe にはアセット表を渡さないため簡略表示になる — v1 の既知制限として受容し「エディタで開く」で補完。stencil 需要が高ければ viewer 用 responses サブセット (stencils/ 約 41MB) の追加供給を将来検討
  - `drawio-iframe-resource-serving` spec は Non-Goal で「キャッシュ機構は別 spec」と明記し、research.md Follow-up に「main.ts レベルで Plugin lifecycle に紐付くキャッシュを追加」とある。**本 spec はその Follow-up の実体化**であり、bootstrap アーキテクチャ・DrawioBridge 公開 API・postMessage 契約を壊さない制約を負う (オブジェクト受理は加法的拡張として同 spec の revalidation 対象)
- **Implications**: 画像プレビュー経路が一段軽量化 (read ゼロ)。preview-init は frame-globals を流用し DRAWIO_BASE_URL を追加設定する

### preview→editor 遷移クラッシュの根本原因調査 (2026-07-19, debug teammate)
- **Context**: 手動確認中に preview→editor 遷移で Obsidian ごとクラッシュ
- **Findings**:
  - 根本原因は「除外後アセット一式 (~110MB 文字列群) の一括 postMessage 転送」によるレンダラメモリスパイク。実測 (Electron getAppMetrics): baseline 253MB → 初回 editor mount で 801MB (**+550MB スパイク**)、以後 830〜1420MB で高止まり
  - 切り分け実験: JSON.stringify 送信へ戻すと悪化 (ピーク 1.98GB)。**structured clone は主因ではない** (仮説棄却)。旧実装で顕在化しなかったのはヘッドルーム差
  - 自動 E2E が pass するのは同一コードパスでもメモリ余裕がある隔離環境のため (非決定的クラッシュ)
  - `performance.memory` は iframe realm を含まず実態を隠す。計測は getAppMetrics RSS が必須
  - Crashpad はこの Electron 構成で無効のためダンプ不在。OOM abort 時の OS ダイアログが teardown の "No dialog is showing" と整合
- **Implications**: 修正はアセット配送の段階化 (design.md「アセット段階配信」章)。ユーザー選択 (2026-07-19): 今回はチャンク配信+Blob 化+コア/テール 2 段構成で解消し、フルオンデマンド配信は将来 spec とする

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| ハイブリッド (採用) | svg/png は内包画像を直接表示、XML は GraphViewer iframe | 最頻ケース (svg/png 閲覧) が 0ms 級、drawio コード不要。XML も 4MB で描画 | 2 種類の表示経路の保守 | ユーザー選択済み |
| GraphViewer 統一 | 全形式を GraphViewer で描画 | 表示経路が 1 本 | svg/png でも常に 4MB ロード | 却下 (ユーザー選択) |
| フルエディタ read-only | chrome=0 で閲覧専用起動 | 実装最小 | 149MB 問題が未解決 | 却下 (ユーザー選択) |
| オンデマンドアセット供給 | iframe から親へ RPC してアセットを都度取得 | メモリ最小 | request-manager の同期解決前提と非互換、大規模改造 | 将来課題として記録 |

## Design Decisions

### Decision: アセットキャッシュはプラグインスコープのセッションキャッシュとする
- **Context**: 要件 5.2 (2 回目以降のエディタ起動でディスク再読込しない)
- **Alternatives Considered**:
  1. ビューごとのキャッシュ — 複数ビュー間で共有できず効果薄
  2. TTL 付きキャッシュ — 要件 5.2 の「セッション内再利用」と相反し複雑化
  3. プラグインスコープ・single-flight・明示 dispose — 採用
- **Selected Approach**: `DrawioAssetCache` を main.ts が所有し、エディタバンドルと viewer スクリプトを個別に遅延ロード + メモ化。並行要求は single-flight (同一 Promise 共有)。プラグイン unload で解放 (要件 5.4)
- **Rationale**: 実装が単純で要件を直接満たす。プレビューデフォルト化によりエディタバンドルのロード自体が稀になる
- **Trade-offs**: エディタを一度でも開くと削減後 ~110MB がメモリ常駐する。閲覧中心ワークフローでは発生しない
- **Follow-up**: 実測でマウント時間を確認 (E2E)。メモリが問題化したら idle eviction を別途検討

### Decision: XML プレビューは GraphViewer 組み込み toolbar を使い、独自ズームプロトコルを作らない
- **Context**: 要件 2.1-2.4 (ズーム・パン・フィット・ページ切替)
- **Alternatives Considered**:
  1. 親側 React ツールバー + postMessage コマンドプロトコル — UI 統一だがプロトコル追加とアイコン資産の検証が必要
  2. GraphViewer 組み込み toolbar (`pages zoom layers`) — 採用
- **Selected Approach**: preview-frame 内で `GraphViewer.createViewerForElement` + toolbar トークン。ズーム/パン/ページ切替は GraphViewer ネイティブ機能に委譲
- **Rationale**: 実績あるコードパスで最小リスク。toolbar 画像は data URI でオフライン完結
- **Trade-offs**: 画像プレビュー (svg/png) 側のズーム UI とは見た目が揃わない。許容し、両経路とも「ビューヘッダの編集アクション」は共通にする
- **Follow-up**: E2E で toolbar 表示とページ切替を検証

### Decision: 外部変更時の XML プレビュー更新は iframe 再マウントで行う
- **Context**: 要件 4.1 (プレビュー自動追従)
- **Selected Approach**: preview-frame に増分更新プロトコルを持たせず、親が iframe を破棄して再マウント
- **Rationale**: viewer iframe は軽量 (4MB / EditorUi なし) で再起動コストが小さい。プロトコル面積を最小化
- **Trade-offs**: 外部変更時にズーム位置がリセットされる (稀なイベントなので許容)
- **Follow-up**: 頻繁な外部変更 (watch 連携) で問題になれば `setXmlNode` による増分更新へ拡張

### Decision: configure ペイロードを structured clone (オブジェクト) で送る
- **Context**: 毎マウント 150MB 級の JSON.stringify / JSON.parse がメインスレッドをブロック
- **Selected Approach**: 親→iframe の `{action:"configure"}` と `{action:"script"}` をオブジェクトのまま postMessage。frame-messenger の受信を `typeof data === "string" ? JSON.parse : data` に拡張。iframe→親および drawio 本体プロトコルは JSON 文字列を維持
- **Rationale**: bootstrap は既に対応済み。structured clone の文字列コピーは native memcpy でエンジン最適化されており、JSON 経路より桁違いに速い
- **Trade-offs**: プロトコルが「文字列/オブジェクト両受理」になり若干緩くなる (受信側 typeof 判定で吸収)
- **Follow-up**: 既存ユニットテスト (frame-messenger.test.ts) に object 受理ケースを追加

### Decision: 既定表示モード設定は `defaultOpenMode` フィールドとして追加し、UI は既存 SettingsTab の最小追加に留める
- **Context**: 要件 6.1-6.3。並行 spec `settings-ui-refresh` が設定画面全体を再構築予定
- **Selected Approach**: `DrawioSettings.defaultOpenMode: "preview" | "editor"` (default `"preview"`) を追加し `migrateSettings` で補完。設定 UI の見た目は settings-ui-refresh 側の所掌
- **Rationale**: データモデルは本 spec、UI 刷新は別 spec という境界を明確化しコンフリクトを回避
- **Trade-offs**: settings-ui-refresh 完了までは既存の (崩れた) UI 上に項目が載る

## Risks & Mitigations
- **アセット除外リストの過剰除外でエディタ機能が欠損** — request-manager が warn + passthrough で劣化許容。除外は「エディタ実行に構造的に不要」と断定できるものに限定し、E2E (起動・編集・保存・More Shapes) で検証。除外リストは 1 定数にまとめ revert 容易にする
- **GraphViewer が期待どおり sandbox iframe 内で動かない** — bootstrap + script 注入という実績ある経路を再利用。失敗時は要件 1.5 のエラー表示 + 「エディタで開く」導線に必ずフォールバック
- **プレビュー→編集遷移中の保存競合** — 遷移時に pending save を flush してからモード切替 (要件 3.4)。DrawioView が保存 Promise を追跡
- **メモリ常駐 (~110MB)** — プレビューデフォルト化で発生頻度自体が下がる。将来の idle eviction 余地を DrawioAssetCache の interface に残す (invalidate())

## References
- `vendor/drawio/src/main/webapp/js/diagramly/GraphViewer.js` — viewer API の一次ソース
- `.kiro/specs/drawio-iframe-resource-serving/` — 既存アセット供給設計 (本 spec が拡張する土台)
- `.kiro/specs/drawio-embed-bridge/` — bridge 状態機械とプロトコルの既存設計
