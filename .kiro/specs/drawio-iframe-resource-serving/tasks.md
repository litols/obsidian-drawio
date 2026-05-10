# Implementation Plan

- [ ] 1. Foundation: ビルド構成と共有型の整備
- [x] 1.1 Vite multi-entry とアセットコピーの拡張
  - 既存本体エントリに加え `src/iframe/init/index.ts` を IIFE エントリとして登録し、`output.entryFileNames` を `iframe-init.js` に固定する
  - `viteStaticCopy` の対象に `vendor/drawio/NOTICE` を `dist/drawio/NOTICE` として追加し、本 spec で生成する `dist/drawio/CHANGES.md` (drawio webapp の起動経路改変点を記述) も同位置にコピー対象とする
  - `vendor/drawio/VERSION` がコピー対象に含まれることを確認し、未含なら明示追加する
  - 本体バンドルのビルドが `dist/iframe-init.js` の生成完了後に走るようビルド順序を保証する
  - 観測可能な完了条件: `pnpm build` 実行後に `dist/iframe-init.js`、`dist/drawio/LICENSE`、`dist/drawio/NOTICE`、`dist/drawio/CHANGES.md`、`dist/drawio/VERSION` がすべて存在する
  - _Requirements: 3.4, 4.1, 4.3_

- [x] 1.2 共有型の定義
  - parent 側と iframe-init 側の双方から参照される `DrawioResponseEntry` (`mediaType` / `href` / `source`) と `DrawioAssetBundle` (`responses` / `indexHtml` / `appJsSource`) を共有モジュールに置く
  - バイナリ表現は `mediaType` の `;base64` サフィックスで識別する規約をコード上に明記する
  - 観測可能な完了条件: parent と iframe-init の両方からこれらの型が import され、TypeScript ビルドが strict mode で通る
  - _Requirements: 1.4, 3.2_

- [ ] 2. Core: parent 側ローダ・bootstrap と in-iframe モジュール群
- [x] 2.1 (P) drawio-asset-loader 実装
  - `vault.adapter.list` で `dist/drawio/` 配下を再帰列挙し、`readBinary` / `read` でアセットを取得する
  - 拡張子に基づき `mediaType` を決定し、バイナリは base64 化して `;base64` サフィックスを付与、テキストは UTF-8 のまま格納する
  - `indexHtml` と `appJsSource` (drawio webapp 本体スクリプト) を `DrawioAssetBundle` の別フィールドで返し、`appJsSource` が空なら結果オブジェクトのエラーフィールドに伝搬する
  - `dispose` で保持していた一時バッファを解放する
  - 観測可能な完了条件: ユニットテストで「テキスト拡張子は UTF-8 文字列、バイナリ拡張子は base64 文字列として `responses` に格納される」「`appJsSource` 取得失敗時に結果がエラーとして返る」が確認できる
  - _Requirements: 1.1, 1.3, 1.4, 3.2, 3.3, 4.1, 4.2_
  - _Boundary: drawio-asset-loader_
  - _Depends: 1.2_

- [x] 2.2 (P) drawio-bootstrap-html 実装
  - `data:text/html,<encodeURIComponent(...)>` に渡せる最小 HTML 文字列を生成する純関数として実装する
  - 戻り値の `<script>` 内で、`window.parent.postMessage(JSON.stringify({event:"iframe"}), "*")` を送出し、`message` listener で `{action:"script", script: source}` を受け取り `document.createElement('script')` + `script.text = source` + `document.head.appendChild` で実行する
  - ユーザ入力を一切混入させず、引数なしで常に同一文字列を返す
  - 観測可能な完了条件: ユニットテストで戻り値文字列が `window.parent.postMessage` 呼び出しと `document.createElement('script')` を含み、`innerHTML` 代入が含まれないことが確認できる
  - _Requirements: 1.1, 3.1_
  - _Boundary: drawio-bootstrap-html_

- [x] 2.3 (P) iframe-init/request-manager 実装
  - `HTMLLinkElement` / `HTMLScriptElement` / `HTMLImageElement` の `setAttribute("href"|"src", ...)` とプロパティ setter をパッチし、相対 URL を Responses 表ベースで Blob URL に解決する
  - `HTMLElement.style` を Proxy 化して CSS 値中の `url(...)` を傍受し書換える
  - `XMLHttpRequest.prototype.open(method, url, ...)` の `url` をパッチする
  - `app://` / `data:` / `https?:` / `//` / `#default#VML` は素通しし、Responses に存在しない URL は `console.warn` のみ出して握りつぶす (外部 fallback は実装しない)
  - 発行済 Blob URL を `Map<href, blobUrl>` でキャッシュし、`dispose` で best-effort revoke する
  - 観測可能な完了条件: jsdom 環境のユニットテストで「`link.setAttribute('href', 'js/main.js')` が Responses 由来 Blob URL に書換わる」「外部 URL は素通しされる」「未登録 URL で `console.warn` が呼ばれ外部リクエストが発生しない」が確認できる
  - _Requirements: 1.1, 1.3, 1.4, 3.2, 4.2_
  - _Boundary: iframe-init/request-manager_
  - _Depends: 1.2_

- [x] 2.4 (P) iframe-init/frame-globals 実装
  - `window.mxLoadResources = false`、`window.mxscript = loadScript` (RequestManager 連携)、`window.isLocalStorage = false`、`window.urlParams = <provided>` を `Object.defineProperty` で設定する
  - `document.cookie` を `value: ""` でスタブ化し、`localStorage` を no-op オブジェクト (`getItem` / `setItem` / `removeItem` が `console.warn` のみ) に置換する
  - 観測可能な完了条件: jsdom 環境のユニットテストで `window.mxLoadResources === false`、`typeof window.mxscript === 'function'`、`window.urlParams.embed === '1'` (供給値) が確認でき、`localStorage.setItem` 呼び出しで warn ログが出ることが確認できる
  - _Requirements: 1.1, 3.1_
  - _Boundary: iframe-init/frame-globals_

- [x] 2.5 (P) iframe-init/frame-messenger 実装
  - `window.addEventListener("message", ...)` で受信し、`event.source !== window.parent` のメッセージは破棄する
  - JSON 解析と handler ディスパッチを一元化し、複数 handler を内部配列で保持する
  - 送信は `window.parent.postMessage(JSON.stringify(msg), "*")` で行う
  - 観測可能な完了条件: ユニットテストで「parent 由来のメッセージが handler に届く」「parent 以外の `event.source` のメッセージは handler に届かない」「送信が JSON 文字列で `window.parent` に到達する」が確認できる
  - _Requirements: 1.2, 2.2, 6.1_
  - _Boundary: iframe-init/frame-messenger_

- [ ] 3. Integration: iframe-init エントリと bridge 内部差し替え
- [x] 3.1 iframe-init エントリ統合
  - `src/iframe/init/index.ts` で「RequestManager 起動 → frame-globals 設置 → frame-messenger 起動 → parent からの `{action:"configure", responses, urlParams}` 受信で Responses 表と `urlParams` を反映 → 以降の `{action:"script"}` を head 注入」の起動シーケンスを実装する
  - drawio webapp の embed プロトコル (`init` / `load` / `save` / `autosave` / `export` / `exit` / `dialog` / `prompt`) を frame-messenger 経由で素通しする
  - 観測可能な完了条件: `pnpm build` で `dist/iframe-init.js` が IIFE として生成され、parent からの mock postMessage 列 (`iframe → script (init) → configure → script (app)`) で内部状態が `init` 受信可能になることが integration テストで確認できる
  - _Depends: 2.3, 2.4, 2.5_
  - _Requirements: 1.1, 1.2, 1.3, 2.2, 3.1_
  - _Boundary: iframe-init entry_

- [x] 3.2 drawio-bridge 内部実装の差し替え
  - `mount` を `idle → loading → bootstrapped → configuring → ready / error → disposed` の状態機械として実装し、`iframe.src` に `data:text/html,<encodeURIComponent(buildBootstrapHtml())>` を設定する
  - bootstrap からの `{event:"iframe"}` を契機に in-iframe init source (本体バンドルへ `?raw` で取り込んだ文字列) を `{action:"script"}` で注入し、続けて `{action:"configure", responses, urlParams}` と drawio app source `{action:"script"}` を順次送出する
  - 受信メッセージは `event.source === iframe.contentWindow` で検証し、`event.origin` 文字列比較は行わない
  - 各段個別タイムアウト (5s/段、合計 15s) で `error` 状態に遷移し、container に loading / error 表示を出す
  - `dispose` で iframe DOM 切離し、message listener 解除、asset-loader.dispose を実行し、Blob URL を完全に解放する
  - 公開シンボル (`DrawioBridge` interface 全メソッド、`createDrawioBridge`、`DrawioInbound` / `DrawioOutbound` / `DrawioInboundExport` / `DrawioBridgeCallbacks`、postMessage event/action 名) は変更しない
  - 観測可能な完了条件: 既存ユニットテストが API 互換を保って green、mock iframe を用いた integration テストで「mount → bootstrapped → configuring → ready」「各段タイムアウトで error」「dispose 後 `isMounted === false` かつ DOM から iframe が外れる」が確認できる
  - _Depends: 2.1, 2.2, 3.1_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.3, 6.1, 6.2, 6.3_
  - _Boundary: drawio-bridge_

- [ ] 4. Validation: ビルド smoke と iframe 依存 E2E の緑化
- [ ] 4.1 ビルド smoke と Apache-2.0 同梱検証
  - `pnpm build` 後に `dist/iframe-init.js`、`dist/drawio/index.html`、`dist/drawio/js/`、`dist/drawio/styles/`、`dist/drawio/images/`、`dist/drawio/LICENSE`、`dist/drawio/NOTICE`、`dist/drawio/CHANGES.md`、`dist/drawio/VERSION` の存在を assert する smoke スクリプトを追加し、CI から呼び出す
  - 観測可能な完了条件: 配布物に必要ファイルが欠ける状態で smoke を走らせるとビルドが赤くなる
  - _Depends: 1.1, 3.1, 3.2_
  - _Requirements: 3.4, 4.1, 4.3_

- [ ] 4.2 (P) E2E drawio-iframe-init 緑化
  - `tests/e2e/drawio-iframe-init.spec.ts` の `test.fixme` を `test` に置換し、残存 FIXME コメントを削除する
  - 待機 / タイムアウトを実機で再調整し、`init` 到達検知ロジックが新方式 (`data:text/html` bootstrap → script 注入経由) と整合することを確認する
  - 本タスクは `theme-follow` E2E には触れないこと (本 spec のスコープ外、別 follow-up)
  - 観測可能な完了条件: Obsidian デスクトップ macOS 上で当該 spec が green
  - _Depends: 3.2_
  - _Requirements: 5.1, 5.4_
  - _Boundary: tests/e2e/drawio-iframe-init.spec.ts_

- [ ] 4.3 (P) E2E three-formats-roundtrip 緑化
  - `tests/e2e/three-formats-roundtrip.spec.ts` の `test.fixme` を `test` に置換する
  - `.drawio` / `.drawio.svg` / `.drawio.png` の 3 形式の load → save round-trip が成立することを実機で確認する
  - 観測可能な完了条件: Obsidian デスクトップ macOS 上で当該 spec が green
  - _Depends: 3.2_
  - _Requirements: 5.2_
  - _Boundary: tests/e2e/three-formats-roundtrip.spec.ts_

- [ ] 4.4 (P) E2E external-sync-reload 緑化
  - `tests/e2e/external-sync-reload.spec.ts` の `test.fixme` を `test` に置換する
  - vault 外で書き換えたファイルが iframe 上にリロードされる導線を実機で確認する
  - 観測可能な完了条件: Obsidian デスクトップ macOS 上で当該 spec が green
  - _Depends: 3.2_
  - _Requirements: 5.3_
  - _Boundary: tests/e2e/external-sync-reload.spec.ts_
