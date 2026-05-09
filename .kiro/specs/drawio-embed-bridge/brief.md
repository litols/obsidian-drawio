# Brief: drawio-embed-bridge

## Problem

draw.io は npm パッケージとして公開されておらず、`jgraph/drawio` リポジトリの `src/main/webapp` 配下に既にビルド済みの webapp が含まれているのみ。これを Obsidian plugin の中で動かすには、サブモジュールとして取り込み、iframe + postMessage プロトコルでホスト (Plugin) と通信させる必要がある。drawio-desktop と同じアーキテクチャをローカルで再現するブリッジ層が不在。

## Current State

- `vendor/drawio` 不在 (submodule 未追加)
- iframe をマウントする host element が plugin-foundation の `onload` 内にまだ存在しない
- drawio が host へ送る postMessage (`load`, `autosave`, `save`, `export`, `exit`, `dialog`, `prompt`) を受信するハンドラ未実装
- host から drawio へ送る outbound メッセージ (XML 注入、テーマ切り替え、ライブラリ追加) のシリアライザ未実装
- drawio webapp が `file://` (or Obsidian 独自プロトコル) で iframe 読み込みできるかは未検証 (Risk)

## Desired Outcome

- `vendor/drawio` が submodule として追加され、`pnpm install` 後に `vendor/drawio/src/main/webapp/index.html` が存在
- ビルド成果物に drawio webapp がまるごと含まれる (`vite-plugin-static-copy` 等で `dist/drawio/` 配下にコピー、または相対パスで参照)
- Plugin が任意のリーフ内に iframe を生成し `index.html?embed=1&proto=json&...` を読み込める
- iframe ↔ Plugin の双方向 postMessage を扱う `DrawioBridge` クラスが存在し、`load(xml)` / `requestSave()` / `requestExport(format)` / `setTheme(...)` 等の高レベル API を提供
- Test 用 `.drawio` ファイル 1 枚を渡すと、iframe 内に drawio の編集 UI が表示され、図形を編集できる (保存はまだファイルに永続化しなくて良い ⇒ file-io spec で実装)

## Approach

- `git submodule add https://github.com/jgraph/drawio.git vendor/drawio` で取り込み
- `vendor/drawio/src/main/webapp/` 配下を `dist/drawio/` にコピー (`vite-plugin-static-copy` の targets に追加)
- Obsidian Electron renderer から `app://` (Obsidian の独自プロトコル) もしくは vault-relative path で iframe src を組み立てる。最初のスパイクで `iframe.src = this.app.vault.adapter.getResourcePath(...)` で疎通させる
- `src/lib/drawio-bridge.ts` に `DrawioBridge` クラスを実装:
  - `mount(container: HTMLElement, opts)`: iframe 生成、`?embed=1&proto=json&...` を組み立て
  - `window.addEventListener('message', ...)` を `iframe.contentWindow` 限定で受信
  - inbound: `event === 'init'` で host から `{action:'load', xml}` を返す、`event === 'save'` / `'autosave'` を高レベルイベントに昇格
  - outbound: `iframe.contentWindow.postMessage({action, xml, format, ...}, '*')`
  - `dispose()`: listener / iframe を完全 cleanup
- `src/lib/drawio-protocol.ts` に postMessage の TypeScript 型 (`DrawioInbound` / `DrawioOutbound`) を定義 (drawio-file-io / settings-and-config が import する **共有契約**)
- 既存図形のデモ表示は固定文字列 (`<mxfile>...</mxfile>`) で済ませ、Vault との接続は file-io に渡す

## Scope

- **In**:
  - `vendor/drawio` submodule の追加と `.gitmodules` 設定
  - drawio webapp の `dist/` 配布パイプライン (vite plugin or postbuild script)
  - `DrawioBridge` クラス (mount / dispose / postMessage 双方向)
  - `DrawioInbound` / `DrawioOutbound` 型定義
  - drawio へ渡す URL パラメータ組み立て (`embed`, `proto`, `spin`, `libraries`, `noSaveBtn`, `noExitBtn`, `lang` など) のヘルパ
  - 疎通用デモ: plugin command (Ribbon ボタン or palette command) で空のリーフに iframe + 固定 XML を表示
  - iframe の Content Security Policy / sandbox 属性の検証 (Obsidian Electron CSP との折り合い)
  - drawio Apache-2.0 ライセンスの再配布 (`vendor/drawio/LICENSE` / `NOTICE` を `dist/` に同梱)
- **Out**:
  - 実際の Vault ファイル読み書き — drawio-file-io
  - 拡張子へのビュー紐付け (`registerView`/`registerExtensions`) — drawio-file-io
  - PNG/SVG メタデータ抽出 — drawio-file-io
  - テーマ追従の実装 (本 spec ではテーマ切替メソッドを **API として用意するだけ**) — drawio-settings-and-config
  - Shape libraries の永続化 — drawio-settings-and-config

## Boundary Candidates

- **Vendor 層**: `vendor/drawio` submodule + 配布パイプライン
- **Bridge 層**: `src/lib/drawio-bridge.ts` (iframe 操作)
- **Protocol 層**: `src/lib/drawio-protocol.ts` (型定義のみ、依存なし)
- **デモ層**: コマンド登録 (file-io が引き継ぐので最小限)

## Out of Boundary

- ファイル形式判定 (XML 圧縮 / SVG / PNG)
- registerView / registerExtensions 呼び出し
- 設定 UI / テーマ実装
- drawio webapp 自体への patch (upstream 改造は out of scope)

## Upstream / Downstream

- **Upstream**: plugin-foundation (`Plugin` エントリ、`onload` 内でブリッジを構築する場所、cleanup 規約)
- **Downstream**:
  - drawio-file-io: `DrawioBridge` を `FileView` 内で `mount()` し、`onSave` でファイルへ書き戻す
  - drawio-settings-and-config: `bridge.setTheme(...)` / `bridge.setLibraries(...)` を呼び、設定を iframe に伝播

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: plugin-foundation (`onunload` で bridge.dispose() を呼ぶ規約に従う)

## Constraints

- **License**: drawio は Apache-2.0。`vendor/drawio/LICENSE` と `NOTICE` を配布物に含めること必須。プラグイン README に "Bundles draw.io (Apache-2.0)" を明記。
- **CSP**: Obsidian の Content Security Policy で `'unsafe-inline'` script の扱いに注意。drawio webapp 内のインラインスクリプトが原因で読めない場合、`webview` 化や `app://` プロトコルハンドラ登録を検討 (Risk)
- **postMessage origin 制限**: `'*'` ではなく iframe.contentWindow 比較で受信元を絞る
- **Bundle size**: drawio webapp は 数十 MB あるため `dist/drawio/` への copy は production build でのみ実施。watch モードでは symlink で十分
- **Submodule 運用**: upstream への追従は手動 (`git submodule update --remote`)。バージョン固定で再現性確保
- **No innerHTML**: bridge / iframe 親 DOM 構築で `createElement` を使う (Submission requirements)
