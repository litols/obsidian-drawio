# 要件ドキュメント

## はじめに

`drawio-embed-bridge` は、draw.io webapp を Obsidian プラグイン内に iframe として埋め込み、postMessage プロトコルを介して双方向通信するブリッジ層を確立する機能である。draw.io は npm パッケージとして公開されておらず、`jgraph/drawio` リポジトリの `src/main/webapp` に含まれるビルド済み webapp を git submodule として取り込む。これにより、後続の drawio-file-io・drawio-settings-and-config spec が共通の通信基盤として利用できる `DrawioBridge` クラスと型定義 (`DrawioInbound` / `DrawioOutbound`) を提供する。

## 境界コンテキスト

- **スコープ内**:
  - `vendor/drawio` git submodule の追加と配布パイプライン
  - `DrawioBridge` クラス (mount / dispose / postMessage 双方向制御)
  - `DrawioInbound` / `DrawioOutbound` postMessage 型定義 (共有契約)
  - drawio iframe への URL パラメータ組み立てヘルパー
  - 疎通確認用デモコマンド (固定 XML を iframe に表示)
  - Content Security Policy / iframe sandbox 属性の疎通検証
  - Apache-2.0 ライセンスファイルの配布物への同梱
- **スコープ外**:
  - Vault ファイルの読み書き (drawio-file-io 担当)
  - `registerView` / `registerExtensions` 登録 (drawio-file-io 担当)
  - テーマ追従の実装 (drawio-settings-and-config 担当、本 spec では API のみ提供)
  - Shape libraries の永続化 (drawio-settings-and-config 担当)
  - PNG / SVG メタデータ抽出 (drawio-file-io 担当)
- **隣接 spec への期待**:
  - `plugin-foundation` の `ObsidianDrawioPlugin` (onload/onunload) が `DrawioBridge` のライフサイクル管理の場を提供する
  - drawio-file-io は `DrawioBridge.mount()` と `onSave` コールバックを利用する
  - drawio-settings-and-config は `DrawioBridge.setTheme()` / `setLibraries()` を呼び出す

## 要件

### 要件 1: vendor/drawio submodule の取り込みと配布パイプライン

**目的:** Obsidian プラグイン開発者として、draw.io webapp を再現性のある方法でビルド成果物に含めたい。そうすることで、iframe が常に同一バージョンの draw.io を読み込める。

#### 受け入れ基準

1. When `pnpm install` を実行したとき、the DrawioEmbedBridge shall `vendor/drawio/src/main/webapp/index.html` が存在する状態を保証する。
2. When `pnpm build` を実行したとき、the DrawioEmbedBridge shall `dist/drawio/` 配下に draw.io webapp のファイル群をコピーする。
3. The DrawioEmbedBridge shall `vendor/drawio` を特定コミットに固定し、`git submodule update --remote` を明示的に実行しない限りバージョンが変わらないことを保証する。
4. When `pnpm dev` (watch モード) でビルドするとき、the DrawioEmbedBridge shall `dist/drawio/` への symlink または同等の軽量手段でファイルを参照できる。
5. The DrawioEmbedBridge shall `vendor/drawio/LICENSE` および `vendor/drawio/NOTICE` を `dist/drawio/` に同梱する。
6. The DrawioEmbedBridge shall `.gitmodules` に submodule URL と path を正しく記録する。

### 要件 2: DrawioInbound / DrawioOutbound 型定義 (postMessage プロトコル契約)

**目的:** プラグイン開発者として、drawio ↔ host 間の postMessage メッセージを型安全に扱いたい。そうすることで、drawio-file-io と drawio-settings-and-config が同じ型定義を import して通信を実装できる。

#### 受け入れ基準

1. The DrawioEmbedBridge shall `src/lib/drawio-protocol.ts` に `DrawioInbound` 型を定義し、draw.io から host へ送られる全メッセージ種別 (`init`, `load`, `autosave`, `save`, `export`, `exit`, `dialog`, `prompt`) を網羅する。
2. The DrawioEmbedBridge shall `src/lib/drawio-protocol.ts` に `DrawioOutbound` 型を定義し、host から draw.io へ送る全メッセージ種別 (`load`, `merge`, `configure`, `layout`, `exportpdf`) を網羅する。
3. The DrawioEmbedBridge shall `DrawioInbound` を discriminated union として定義し、`event` フィールドによる型の絞り込みが可能な状態にする。
4. The DrawioEmbedBridge shall `DrawioOutbound` を discriminated union として定義し、`action` フィールドによる型の絞り込みが可能な状態にする。
5. The DrawioEmbedBridge shall `DrawioInbound` / `DrawioOutbound` に `any` 型を使用しない。
6. The DrawioEmbedBridge shall これらの型定義を `src/lib/drawio-protocol.ts` からエクスポートし、他のモジュールが `import type` で参照できる状態にする。

### 要件 3: DrawioBridge クラス (iframe マウントと postMessage 双方向制御)

**目的:** Obsidian プラグイン開発者として、draw.io iframe の生成・メッセージ受信・破棄を高レベル API で制御したい。そうすることで、後続 spec が低レベルの postMessage 処理を再実装せずに drawio を操作できる。

#### 受け入れ基準

1. When `DrawioBridge.mount(container, opts)` を呼び出したとき、the DrawioBridge shall `container` 内に `<iframe>` を生成し `?embed=1&proto=json` を含む URL を設定する。
2. The DrawioBridge shall `window.addEventListener('message', ...)` を追加するときに `iframe.contentWindow` の origin で送信元を検証し、他の postMessage を誤って受信しない。
3. When draw.io から `event === 'init'` メッセージを受信したとき、the DrawioBridge shall host から `{action: 'load', xml: string}` を drawio へ返信する。
4. When draw.io から `event === 'save'` または `event === 'autosave'` メッセージを受信したとき、the DrawioBridge shall 登録されたコールバック (`onSave` / `onAutosave`) を呼び出す。
5. When draw.io から `event === 'export'` メッセージを受信したとき、the DrawioBridge shall 登録されたコールバック (`onExport`) を呼び出し、エクスポートデータを渡す。
6. When `DrawioBridge.load(xml)` を呼び出したとき、the DrawioBridge shall drawio iframe へ `{action: 'load', xml}` を postMessage する。
7. When `DrawioBridge.requestSave()` を呼び出したとき、the DrawioBridge shall drawio iframe へ保存要求の postMessage を送る。
8. When `DrawioBridge.requestExport(format)` を呼び出したとき、the DrawioBridge shall drawio iframe へ `{action: 'export', format}` を postMessage する。
9. When `DrawioBridge.setTheme(theme)` を呼び出したとき、the DrawioBridge shall drawio iframe へテーマ切替の postMessage を送る。
10. When `DrawioBridge.setLibraries(libs)` を呼び出したとき、the DrawioBridge shall drawio iframe へ shape libraries 設定の postMessage を送る (downstream の drawio-settings-and-config から呼ばれる安定 API)。
11. When `DrawioBridge.replaceContent(xml)` を呼び出したとき、the DrawioBridge shall mount 済みの drawio iframe へ図 XML を差し替える postMessage を送る (load との違いは「初期化済み iframe にライブで再注入する」点)。
12. When `DrawioBridge.dispose()` を呼び出したとき、the DrawioBridge shall 次の順序で cleanup を実行する: (a) `window.removeEventListener` でメッセージリスナー解除、(b) callbacks 参照クリア、(c) `iframe.src = 'about:blank'` で contentWindow を切断、(d) `iframe.remove()` で DOM 除去、(e) 内部参照を null クリア。
13. The DrawioBridge shall `<iframe>` を生成するときに `innerHTML` を使用せず `document.createElement('iframe')` を使用する。
14. If `DrawioBridge.mount()` を既にマウント済みのインスタンスで再度呼び出したとき、the DrawioBridge shall 既存の iframe と listener を dispose してから新規 mount を実行する。
15. If `DrawioBridge.dispose()` が複数回呼ばれたとき、the DrawioBridge shall 冪等に処理し 2 回目以降は no-op とする。
16. If `DrawioBridge` の outbound API (`load` / `requestSave` / `requestExport` / `setTheme` / `setLibraries` / `replaceContent` / `sendMessage`) が mount 前または dispose 後に呼ばれたとき、the DrawioBridge shall 警告ログを出力し例外を throw せず no-op とする。

### 要件 4: drawio URL パラメータ組み立てヘルパー

**目的:** プラグイン開発者として、iframe の src URL に付与するクエリパラメータを安全かつ一貫した方法で組み立てたい。

#### 受け入れ基準

1. The DrawioEmbedBridge shall `embed=1` および `proto=json` を常に URL パラメータに含める関数を提供する。
2. The DrawioEmbedBridge shall `spin`, `libraries`, `noSaveBtn`, `noExitBtn`, `lang` など追加パラメータを任意で渡せるオプション型を持つ。
3. The DrawioEmbedBridge shall 組み立てた URL を返す純粋関数として実装し、副作用を持たない。
4. When `lang` パラメータが指定されないとき、the DrawioEmbedBridge shall `lang=ja` をデフォルトとして使用する。

### 要件 5: Obsidian プロトコルでの iframe src 疎通

**目的:** プラグイン開発者として、Obsidian Electron renderer の CSP 制約下で iframe が draw.io を読み込めることを確認したい。

#### 受け入れ基準

1. When プラグインが Obsidian Desktop 上で実行されるとき、the DrawioBridge shall `app.vault.adapter.getResourcePath()` または同等の手段で `dist/drawio/index.html` への絶対パスを取得できる。
2. When iframe src を設定するとき、the DrawioBridge shall Obsidian の `app://` プロトコルまたは `file://` プロトコルで draw.io webapp を読み込める。
3. If iframe が CSP 違反によりスクリプトをブロックされたとき、the DrawioBridge shall コンソールに警告を出力し、`webview` 化や `app://` プロトコルハンドラ登録の代替手段を検討できる状態にする。
4. The DrawioBridge shall iframe に `sandbox` 属性を設定するときに `allow-scripts allow-same-origin allow-downloads` を最低限含める。

### 要件 6: 疎通確認用デモコマンド

**目的:** プラグイン開発者として、実際の Vault ファイルなしでも draw.io の編集 UI が表示できることを確認したい。そうすることで、ブリッジ層の動作を独立して検証できる。

#### 受け入れ基準

1. When Obsidian のコマンドパレットから "Open drawio demo" コマンドを実行したとき、the DrawioEmbedBridge shall 新しいリーフを開き、その中に DrawioBridge 経由で draw.io iframe を表示する。
2. When デモコマンドが実行されたとき、the DrawioEmbedBridge shall 固定の `<mxfile>` XML を drawio へ渡し、図形が描画された状態で表示する。
3. When リーフが閉じられたとき、the DrawioEmbedBridge shall `DrawioBridge.dispose()` を呼び出し iframe と listener を完全に解放する。
4. The DrawioEmbedBridge shall デモコマンドを `ObsidianDrawioPlugin.onload()` 内で登録し、`onunload()` では自動的に登録解除される Obsidian の Command 機構を使用する。

### 要件 7: cleanup と Obsidian 審査要件の準拠

**目的:** Obsidian コミュニティプラグイン審査担当者として、プラグインが審査要件を満たしていることを確認したい。

#### 受け入れ基準

1. The DrawioEmbedBridge shall DOM 操作に `innerHTML` を使用しない。
2. The DrawioEmbedBridge shall 外部 CDN からスクリプトを読み込まない。
3. When `ObsidianDrawioPlugin.onunload()` が呼ばれたとき、the DrawioEmbedBridge shall すべての `DrawioBridge` インスタンスの `dispose()` が呼ばれた状態にする。
4. The DrawioEmbedBridge shall `vendor/drawio/LICENSE` を配布物に含め、プラグインの README に "Bundles draw.io (Apache-2.0)" を明記する。
5. The DrawioEmbedBridge shall postMessage の送受信で `'*'` origin を受け入れる `addEventListener` を使用せず、iframe の `contentWindow` を基準に送信元を検証する。
6. The DrawioEmbedBridge shall README.md (or NOTICE) に "Bundles draw.io (Apache-2.0)" を明記する。
7. The DrawioEmbedBridge shall `vendor/drawio` を特定の release タグに固定し、`.gitmodules` または別途 docs にその tag 値を記録する (例: `v24.7.17`)。CI / `pnpm install` 経由で `--remote` 更新を自動実行しない。
