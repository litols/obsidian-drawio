# Research & Design Decisions: drawio-iframe-resource-serving

## Summary

- **Feature**: `drawio-iframe-resource-serving`
- **Discovery Scope**: Extension (brownfield、`drawio-embed-bridge` の内部実装差し替え)
- **Key Findings**:
  - Obsidian デスクトップでは `app://` プロトコル経由の sub-resource (相対参照される js/css/画像) が `ERR_BLOCKED_BY_CLIENT` で拒否される。`--disable-web-security` でも回避不能であり、Chromium ではなく Obsidian / Electron の `webRequest` レイヤによる制限と推定される。
  - Obsidian の公開 API には Electron `protocol.handle` 相当のリソース配信スキーム登録が存在せず、`registerObsidianProtocolHandler` は `obsidian://` deep link 用のため本件には使えない。Electron 内部の `protocol` モジュール直接利用は private API 依存となり Community Plugin Guidelines に違反する。
  - 静的書き換え (`index.html` の DOM パースで相対参照を Blob URL へ書換) だけでは不十分。drawio webapp は **ランタイムに XHR / 動的 `<script>` / `<img>` / インライン `style` で追加リソースを取得する** ため、iframe 内部でこれらの取得 API をパッチして傍受する必要がある。実用解は **`data:text/html,` 最小ブートストラップ + postMessage によるスクリプト逐次注入 + in-iframe DOM API パッチによるリソース傍受 + Blob URL 解決** ハイブリッド方式となる。

## Research Log

### Topic: app:// プロトコル sub-resource ブロックの根拠

- **Context**: 既存の `drawio-bridge.ts` が `app.vault.adapter.getResourcePath(...)` で生成する `app://[hash]/...drawio/index.html` を iframe `src` に渡しているが、`index.html` から相対参照される `js/main.js` 等が拒否される。
- **Sources Consulted**:
  - Obsidian Forum: "Can iframe sandbox restrictions be removed via a plugin?" (2021–2024)
  - Electron `protocol` ドキュメント (`registerSchemesAsPrivileged` は `app.ready` 前にのみ呼べる)
  - Obsidian Developer Documentation: `DataAdapter.getResourcePath`
- **Findings**:
  - Obsidian は内部で `app://` を privileged scheme として登録しており、登録パターンに合致しないファイルアクセスを `webRequest` レイヤでフィルタしている。
  - sub-resource の拒否は iframe sandbox 属性とは独立に発生する。
  - `--disable-web-security` を Electron に渡しても挙動が変わらないことから、Chromium の web security ではなく Obsidian の独自フィルタで弾かれている。
- **Implications**: `app://` 経由でのリソース取得は将来も保証されない。代替経路を要する。

### Topic: 候補ロード戦略の比較

- **Context**: 複数の候補から実装可能かつ Community Plugin Guidelines に適合する戦略を選定する必要がある。
- **Sources Consulted**: Obsidian Plugin guidelines、drawio embed mode FAQ、Electron breaking changes、drawio "Embedding walk-through" 公式ブログ。
- **Findings**: 後述の Architecture Pattern Evaluation 表参照。
- **Implications**: `data:text/html,` bootstrap + postMessage script injection + in-iframe DOM API パッチ方式が、外部ネット不要・private API 不要・動的リソース取得もカバーできる唯一の現実解。

### Topic: drawio webapp が要求する動的リソース取得の傍受

- **Context**: drawio webapp は静的に index.html から参照されるアセットだけでなく、ランタイムに次の経路でリソースを取得する。これらを傍受しなければ `app://` ブロックに当たり起動が破綻する。
- **Findings**:
  - `mxLoadResources` グローバルが既定 `true` の場合、起動時に翻訳リソース (`resources/dia*.txt`) を XHR で取得しようとする。`mxLoadResources = false` を `<head>` 早期に設定することで抑止できる。
  - `mxscript(src)` グローバルが drawio から呼ばれる箇所がある (拡張 / プラグインスクリプト)。この関数を上書きして `document.createElement('script')` 経由のロードに差し替える。
  - 図形ライブラリ / スタンプ / カスタム拡張の取得は XHR で発生する。`XMLHttpRequest.open` をパッチして URL を Blob URL へ書き換える。
  - 画像・CSS は HTMLImageElement / HTMLLinkElement の `src` / `href` を `setAttribute` / プロパティ setter 双方経由で設定するため、両方をパッチする必要がある。
  - インライン CSS の `url(...)` 参照は HTMLElement の `style` プロパティに対する Proxy で傍受する。
- **Implications**: 静的 HTML 書き換えは不十分。in-iframe にロードするコードで DOM API / XHR をパッチする方式が必須。

### Topic: drawio embed mode bootstrap の前提

- **Context**: 採用する戦略が drawio webapp の embed mode と互換である必要がある。
- **Sources Consulted**: drawio.com `Embed mode`、`Configure the draw.io editor`、`Supported URL parameters`。
- **Findings**:
  - URL は `?embed=1&proto=json` (+ 任意 `configure=1` / `ready=<msg>` / `lang=<code>`)。`data:` URL bootstrap では URL クエリ取得不可なので、`window.urlParams` (drawio が参照する組込グローバル) を bootstrap 内で直接設定する。
  - bootstrap 完了で iframe → parent に `{event:'init'}` を `postMessage(JSON, '*')` で送信。
  - self-host では origin 厳密検証を行わない (`*` 送信前提)。受信側は `event.source === iframe.contentWindow` で同定する。
- **Implications**: `data:` 由来の `null` origin と `urlParams` グローバル直設定でも embed mode は成立する。

### Topic: Apache-2.0 同梱要件

- **Context**: `vendor/drawio` を再配布するための法務要件を満たす。
- **Findings**:
  - 配布物に `LICENSE` 全文 (`vendor/drawio/LICENSE` 由来) を `dist/drawio/LICENSE` として既にコピー済 (`vite.config.ts`)。
  - `NOTICE` ファイル (jgraph 由来) を別途同梱する必要がある。
  - 本 spec の bootstrap 改変は drawio webapp の改変ではないが、Plugin が webapp の起動経路を変更する旨を記載した `dist/drawio/CHANGES.md` を同梱しておくと再配布要件を厳格に満たせる。
- **Implications**: `vite.config.ts` の static copy 対象に NOTICE と CHANGES を加える、または明示的に生成する。

### Topic: 既存 API 表面の維持

- **Context**: drawio-file-io / drawio-settings-and-config / drawio-external-sync が `DrawioBridge` 型を import しており、契約変更は破壊変更となる。
- **Findings**:
  - 維持すべき公開シンボル: `DrawioBridge` interface (`mount`, `dispose`, `load`, `replaceContent`, `requestSave`, `requestExport`, `setTheme`, `setLibraries`, `sendMessage`, `isMounted`)、`DrawioInbound` / `DrawioOutbound` / `DrawioInboundExport` / `DrawioBridgeCallbacks`、`buildDrawioUrl` の `DrawioUrlOptions`。
  - postMessage の event 名 (`init`, `load`, `save`, `autosave`, `export`, `exit`, `dialog`, `prompt`) と `action` 種別 (`load`, `merge`, `configure`, `layout`, `export`) は不変。
- **Implications**: 本 spec は `drawio-bridge.ts` の **内部実装** のみを差し替える。型および関数シグネチャは維持する。

### Topic: in-iframe で動かすコードのビルド経路

- **Context**: in-iframe でしか動かないコード (DOM API パッチ、Frame messenger、`mxLoadResources` 設定) は、Obsidian Plugin の本体バンドルとは別文脈で実行される。これらをどう供給するか。
- **Findings**:
  - 文字列としてバンドル時に注入する方式が確実。Vite の `?raw` import を使い、別エントリで IIFE ビルドした成果物を文字列として読み込み、parent から postMessage 経由で iframe に注入する。
  - drawio webapp の本体 (`app.min.js` 等) は配布物 `dist/drawio/` 配下に既に存在するため、parent が `vault.adapter.readBinary` で実行時に読み出して同様に注入する。
  - 別エントリビルドは Vite の `build.rollupOptions.input` 複数指定または独立した `vite.iframe-init.config.ts` で実現可能。前者の方が pnpm scripts を増やさず単純。
- **Implications**: `vite.config.ts` を rollupOptions multi-entry に拡張し、in-iframe 用エントリを `dist/iframe-init.js` として IIFE 出力する。本体ビルドはそれを `?raw` で取り込み文字列同梱する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| `app://` 維持 | 既存方式 | 実装変更不要 | sub-resource ブロックで動作不能 | 不適合 |
| `registerObsidianProtocolHandler` | Obsidian 公開 API による URI ハンドラ登録 | 公開 API、cleanup 容易 | 用途は `obsidian://` deep link、リソース配信不可 | 不適合 |
| Electron `protocol.handle` | カスタムスキームを main プロセスで登録しレンダラから配信 | 任意 MIME 配信可能 | private API 経由、Community Plugin Guidelines 違反 | 採用不可 |
| `file://` 直接 | iframe `src="file:///abs/path/index.html"` | 実装最小 | Obsidian webRequest が拒否、postMessage origin が `null`、`app://` 配下からの navigation は webSecurity でブロック | 採用不可 |
| `srcdoc` + 静的書換のみ | parent が index.html をパースして相対参照を Blob URL に書換 | 1 段階で完結 | drawio の動的 XHR / 動的 script / 動的 img を傍受できず実機で破綻する | 採用不可 |
| **`data:text/html,` bootstrap + postMessage script 注入 + in-iframe DOM API パッチ** | iframe は最小 bootstrap のみ、parent から script を逐次注入し iframe 側で全リソース取得 API をパッチして Blob URL 解決 | 公開 API のみ、外部ネット不要、cleanup 容易、動的リソースもカバー、postMessage は `event.source` 比較で成立 | 起動段数が多い、in-iframe コードを別エントリでビルドする必要、Apache-2.0 NOTICE 同梱必須 | **採用** |
| Service Worker | SW で fetch を中継 | パターンとしては自然 | `app://` での SW 登録不可、main プロセスでの事前 `registerSchemesAsPrivileged` 必要、Obsidian は許可していない | 採用不可 |

## Design Decisions

### Decision: リソース配信戦略は data: bootstrap + postMessage script 注入 + in-iframe DOM API パッチ

- **Context**: `app://` sub-resource ブロックを回避しつつ、drawio webapp の動的リソース取得もカバーする必要がある。
- **Alternatives Considered**:
  1. `srcdoc` + 静的書換のみ — 動的取得を傍受できず実機で破綻するため却下。
  2. Electron `protocol.handle` — private API 依存で却下。
  3. `file://` 直接 — Obsidian の webRequest 制限と origin 問題で却下。
  4. Service Worker — `app://` での登録不可で却下。
- **Selected Approach**:
  1. iframe の `src` は `data:text/html,` で構成した最小 HTML。中身は parent からの postMessage を待ち、最初のメッセージで script を `<script>` element として `head` に挿入する純粋な listener のみ。
  2. parent は iframe の `iframe` event (bootstrap が DOM に attach された通知) を受け取ったら、以下を順次 postMessage `{action:"script", script: source}` で注入する:
     - 自前の "init" コード — `HTMLLinkElement.setAttribute` / `HTMLScriptElement.setAttribute` / `HTMLImageElement.setAttribute` / `HTMLElement.style` (Proxy) / `XMLHttpRequest.open` をパッチして相対 URL を Responses 表ベースで Blob URL に解決する。`mxLoadResources = false` / `mxscript` 上書き / `document.cookie` / `localStorage` のスタブ化を含む。`urlParams` (`embed=1&proto=json` 等) を `window.urlParams` に直接設定する。
     - drawio webapp 本体 (`app.min.js` 相当) — `vault.adapter.readBinary` で `dist/drawio/` 配下から読み出した文字列。
  3. drawio webapp は in-iframe のパッチ済 API 経由で全サブリソースを取得する。Responses 表に存在しない URL はコンソール警告のみで握りつぶし、起動を継続させる。
  4. drawio webapp は bootstrap 完了で `{event:"init"}` を parent に送出。以後は既存の `DrawioBridge` postMessage プロトコルが従来通り機能する。
- **Rationale**: 静的書換だけでは drawio の動的リソース取得をカバーできないため、必ず in-iframe にパッチコードを置く必要がある。それを実現する経路として、Obsidian/Electron の private API に依存しない、外部ネットワーク不要で community plugin 審査を通せる方式は本ハイブリッドのみ。
- **Trade-offs**:
  - 起動段数が多くなる (iframe DOM 挿入 → bootstrap → iframe event → init script 注入 → app script 注入 → drawio init)。タイムアウトとエラー UI を要する。
  - in-iframe 用コードを別 Vite エントリでビルドする必要がある (本体バンドルとはツールチェーン共通だが、`format: 'iife'` の独立成果物)。
  - Blob URL は明示 `revokeObjectURL` を伴う cleanup を要する。
  - `data:text/html,<encoded>` は `innerHTML` ではないため Community Plugin Guidelines に抵触しない。bootstrap にユーザ入力を混ぜないことが必須条件。
- **Follow-up**:
  - 初回ロード性能を E2E 上で実測し、必要なら `init` script を build-time にバンドル文字列化する代わりに Vite の `?raw` import に変更してホットリロード時間を改善する。
  - drawio webapp のバージョン更新時に動的リソース取得経路が増えていないかを CI smoke で確認する。

### Decision: アセットは起動時一括ロードでキャッシュなし

- **Context**: `dist/drawio/` 配下のファイル数は多く、Responses 表の構築に I/O が必要。キャッシュレイヤを設けるかが論点。
- **Alternatives Considered**:
  1. `bridge` 起動毎に都度全アセット読み出し。
  2. `Map<path, Blob>` を main.ts ライフサイクルでキャッシュ。
  3. アセットを base64 で `import` してビルド時インライン化。
- **Selected Approach**: bridge mount のたびに必要アセットを `vault.adapter.readBinary` で読み出し、Responses 表 (`{ mediaType, href, source }[]` を JSON 化したもの) を構築して in-iframe へ注入する。dispose 時に Blob URL を revoke。
- **Rationale**:
  - 単一ファイル単位の編集セッションで bridge が再 mount される頻度は低く、キャッシュの効果が薄い。
  - ビルド時インライン化はバンドルサイズを大幅に増やし Apache-2.0 NOTICE の同梱経路を不明瞭にする。
  - キャッシュを跨いだ Blob URL ライフサイクル管理はバグの温床になりやすい。
- **Trade-offs**: 同一セッションで複数の `.drawio` を順次開くケースで I/O が重複する。後続最適化の余地として記録。
- **Follow-up**: パフォーマンス問題が観測されれば main.ts レベルで Plugin lifecycle に紐付くキャッシュを追加する (本 spec 範囲外)。

### Decision: API 表面は維持し内部実装のみ差し替え

- **Context**: 上位 spec が `DrawioBridge` インターフェースを import 済。
- **Selected Approach**: `src/lib/drawio-bridge.ts` の関数シグネチャ・型定義・postMessage event 名は維持。`mount` 内部の iframe 生成箇所のみ data:text/html bootstrap + script 注入方式に差し替える。
- **Rationale**: 本 spec の Boundary Commitments に従い、上位 spec への破壊変更を避ける。
- **Trade-offs**: なし。
- **Follow-up**: 既存ユニットテストが API 互換を担保していることを CI で確認する。

## Risks & Mitigations

- **Blob URL revoke 漏れによるメモリリーク** — `dispose()` で発行済 Blob URL をすべて `revokeObjectURL` する。bridge 内部で発行履歴 (parent 側、iframe 側 RequestManager 双方) を保持し、`onunload` 経路と E2E でカバーする。
- **drawio webapp 内部の動的リソース読み込みが想定外パスから発生** — in-iframe のパッチで `console.warn` を出し、E2E と smoke で検出する。`Responses` 表に存在しない URL は警告のみで握りつぶし、必要なら `XMLHttpRequest.open` パッチで `app://` 等への直アクセスを禁止する。
- **`data:` 由来の null origin での postMessage 検証** — `event.source === iframe.contentWindow` 比較を採用。origin 文字列比較を行わない。
- **Apache-2.0 NOTICE 同梱不足** — `vite.config.ts` の static copy 対象に `NOTICE` と `CHANGES.md` を追加する。
- **初回ロード時間の劣化** — Loading 表示 (Requirement 6.2) を維持し、E2E のタイムアウトを実測値で再調整する。閾値超過時は遅延ロードへの段階的移行を検討。
- **in-iframe 用エントリの別ビルド** — Vite multi-entry 設定の typo / 未配備で本体ビルドがリリース成果物に init.js を含めずデグレする恐れ。CI で `dist/iframe-init.js` の存在を assert する smoke を追加する。

## References

- [registerObsidianProtocolHandler – Obsidian Developer Documentation](https://docs.obsidian.md/Reference/TypeScript+API/Plugin/registerObsidianProtocolHandler) — `obsidian://` deep link 用 API、本件不適合の根拠。
- [Plugin guidelines – Obsidian Developer Documentation](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) — `innerHTML` 禁止、外部 CDN 禁止、cleanup 要件。
- [DataAdapter.getResourcePath – Obsidian Developer Documentation](https://docs.obsidian.md/Reference/TypeScript+API/DataAdapter/getResourcePath) — `app://` URL 生成 API。
- [protocol – Electron Documentation](https://www.electronjs.org/docs/latest/api/protocol) — `protocol.handle` の制限。
- [Embed mode – draw.io](https://www.drawio.com/doc/faq/embed-mode) — `init` postMessage シーケンス。
- [Supported URL parameters – draw.io](https://www.drawio.com/doc/faq/supported-url-parameters) — `embed=1&proto=json` パラメータ仕様。
- Vite [`?raw` import](https://vitejs.dev/guide/assets#importing-asset-as-string) — in-iframe コードを文字列として本体バンドルに含める手段。
