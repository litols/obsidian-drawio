# Brief: drawio-external-sync

## Problem

`.drawio` / `.drawio.svg` / `.drawio.png` ファイルは Obsidian の外側からも変更され得る。具体的には:

- ユーザの **AI エージェント / CLI / Claude Code 等**が同じ Vault に対して draw.io の XML を直接書き換える
- Git pull / file sync (Syncthing, iCloud, Dropbox) によりローカルファイルが入れ替わる
- drawio-desktop など別の編集ツールが同じファイルを保存する

ファイルが Obsidian の外で書き換えられても、Obsidian 内で開いている `DrawioView` には反映されない。最悪、編集中の view が古い XML を保存し直して **外部変更を上書きしてしまう**。AI エージェントが図を更新するワークフローでは特にこの破壊が致命的。

## Current State

- `DrawioView` (drawio-file-io) は `onLoadFile` 時にだけ XML を読み込み、その後は drawio iframe 内の編集状態が真実 (source of truth) になっている
- Obsidian の `Vault.on('modify')` 購読なし
- 外部変更が起きても通知も reload もしない
- ローカル編集中 (iframe 内 dirty) との衝突解消ポリシー未定義
- 「AI エージェントが図を更新したことをユーザに知らせる」UX なし

## Desired Outcome

- ユーザが Obsidian 内で `.drawio` / `.drawio.svg` / `.drawio.png` を開いている間、ファイルが外部から変更されたら **検知して通知する**
- 通知 UX は **3 段階の表現**:
  1. **Status bar** に小さく "Diagram updated externally" を恒常表示 (`addStatusBarItem`)
  2. **Obsidian Notice** (右上トースト) を `new Notice('...')` で発火
  3. View 内に **action banner** ("外部で更新されました [Reload] [Diff] [Keep mine]")
- ユーザの **dirty 状態** に応じて挙動が分岐:
  - **Not dirty** (iframe 内に未保存編集なし) → 既定で **auto reload** (設定で disable 可)
  - **Dirty** → 自動 reload しない。banner で `[Reload] [Diff] [Keep mine and overwrite]` を提示
- `Diff` を押すと、現在 iframe 内の XML と Vault の最新 XML を簡易テキスト diff (codemirror 6 の `mergeView` or 軽量な行 diff) で modal に表示
- `Reload` で Vault の最新を `bridge.load(xml)` で再投入し、iframe を更新
- `Keep mine and overwrite` で現在の iframe 内 XML を保存し外部変更を捨てる (確認 modal を 1 段挟む)
- AI エージェント向けに、Obsidian command **"Refresh diagram from disk"** と Plugin event **`drawio:external-change`** を expose し、エージェントが自分で更新後に Obsidian 側へ "再読込してください" を発火できる
- AI ワークフロー想定で、コマンド経由で「現在開いている図ファイルの XML を取得 / 置換 / 保存」を行う **Public API** (`plugin.api.getDiagramXml(file)` / `plugin.api.setDiagramXml(file, xml, {reason})`) を提供。reason フィールドに `"agent:claude-code"` などを渡せて通知に表示

## Approach

- `src/lib/external-watch.ts` に `ExternalWatcher` クラスを実装
  - `Vault.on('modify')` / `'rename'` / `'delete'` を購読
  - 自分が直前に書いた変更 (drawio-file-io の writer) は **echo 抑制** する: 書き込み時に `mtime + path` を `recentSelfWrites: Map<string, number>` に積み、`'modify'` イベントの mtime と一致 (差分 200ms 以内) なら無視
  - 残った modify を `ExternalChangeEvent { file, mtime, sourceHint? }` として Plugin の event bus に流す
- `DrawioView` 側に `ExternalChangeEvent` を購読する subscribe を追加:
  - `event.file === this.file` のとき、現在の dirty フラグ (drawio iframe からの `autosave` 受信を覚えておくフラグ) を見て、auto reload or banner 表示を分岐
  - banner は React で view container 内に `createRoot` してマウント、`onunload` で必ず unmount
- `src/lib/diff-modal.tsx` に React 製 diff modal を実装 (Obsidian の `Modal` を React で wrap、依存は最小)
- Plugin Public API:
  - `manifest.json` に `id` を確定し、他のプラグイン / 外部スクリプトから `app.plugins.plugins['obsidian-drawio'].api` で取得できる pattern (Obsidian 慣習) を提供
  - API 経由で更新があった場合、`reason` を含む通知を発火 (`Notice("Diagram updated by Claude Code")`)
- AI ワークフロー向けに **"Edit with AI request"** プレースホルダ command を 1 つ用意。実装は後追い (本 spec では event 露出のみ)。
- 設定 (drawio-settings-and-config 側で持つ key) に以下を追加:
  - `externalSync.autoReloadWhenClean` (default: true)
  - `externalSync.notifyOnExternalChange` (default: true)
  - `externalSync.notificationLevel` ('silent' | 'statusbar' | 'notice' | 'banner', default: 'banner')
  - `externalSync.echoSuppressionMs` (default: 300)
  - settings spec に **依存して** UI を生やすため、本 spec は **schema 拡張 + 既定値** のみ提供し、UI は drawio-settings-and-config に小さく追補

## Scope

- **In**:
  - `Vault` イベント購読 (modify / rename / delete) と self-write echo 抑制
  - `ExternalChangeEvent` の Plugin event bus 露出 (`plugin.events.on('drawio:external-change', ...)` 相当)
  - `DrawioView` への banner / auto-reload / dirty 判定統合
  - 3 段階通知 (status bar / Notice / view banner)
  - Diff modal (text diff、簡易表示)
  - Conflict 解消 actions: Reload / Keep mine / Diff
  - Public API: `getDiagramXml` / `setDiagramXml` / `requestReload(file)` / event subscription
  - drawio-settings-and-config への schema 追加 (UI そのものは settings spec 内で render)
  - 通知の dedup (同一 mtime に対する重複 fire を抑制)
  - rename / delete されたファイルへの対応 (view を閉じる、または rename を追従)
- **Out**:
  - 3-way merge / セマンティック diff (mxfile XML 構造を理解した merge は本 spec では作らない)
  - drawio iframe 内の visual diff overlay
  - リアルタイム共同編集 (CRDT)
  - Git 統合 (commit / blame)
  - クラウドストレージ独自 API
  - AI ワークフローそのもの (本 spec は AI エージェントが叩ける hook を露出するのみ)
  - Mobile 環境 (`isDesktopOnly: true`)

## Boundary Candidates

- **Watch 層**: `src/lib/external-watch.ts` (Vault event 購読 + echo 抑制 + event bus)
- **View 統合層**: `DrawioView` 内の subscribe + dirty 判定 + banner mount
- **UX 層**: status bar / Notice / banner / diff modal (React)
- **Public API 層**: `src/lib/plugin-api.ts` (`getDiagramXml` / `setDiagramXml` / `requestReload` / subscribe)
- **Settings 層**: schema 拡張 (UI は drawio-settings-and-config に渡す)

## Out of Boundary

- 図ファイル自体の reader/writer (drawio-file-io が引き続き責任)
- Obsidian テーマ追従
- Settings UI 描画
- Vendor / iframe / postMessage 自体の改造
- AI エージェント側のロジック / プロンプト

## Upstream / Downstream

- **Upstream**:
  - plugin-foundation (`Plugin` クラス、`onload`/`onunload`、設定 load/save)
  - drawio-embed-bridge (`DrawioBridge.load(xml)` を再呼び出しする)
  - drawio-file-io (`DrawioView` 内に hook ポイント、reader/writer の reusable export)
- **Downstream**:
  - drawio-settings-and-config: 本 spec が追加する schema を UI に露出
  - 将来の AI エージェント連携 spec (もし作る場合): `plugin.api` を消費する

## Existing Spec Touchpoints

- **Extends**:
  - drawio-file-io: `DrawioView` に dirty フラグ / `reload(file)` メソッド / external-change subscriber を生やす。reader を view 外から呼び直せるように pure function 化 (`readDrawioFile(file): Promise<{xml, format}>`)
  - drawio-settings-and-config: 本 spec の設定 schema を UI に追加
- **Adjacent**:
  - drawio-embed-bridge: `setXml(xml)` 系の外部投入 API があれば再利用 (なければ bridge spec で `bridge.replaceContent(xml)` を追加してもらう)
  - plugin-foundation: Public API を `manifest.json#id` に紐づけて公開する規約

## Constraints

- **Echo suppression**: 自プラグインの書き込みを外部変更と誤認しないよう、書込み時刻 (mtime) と path で短時間 (200-500ms) フィルタ。長すぎると本物の外部変更を取りこぼすので **設定可能** にする
- **Dedup**: 1 つの外部書込みが modify event を 2 回発火することがある (Obsidian の挙動)。最後の event から `debounceMs` (既定 100ms) でまとめる
- **No external network**: 通知や差分計算はローカルのみ。Submission requirements 準拠
- **innerHTML 禁止**: banner / Notice / modal すべて React or `createElement` 経由
- **Cleanup**: ExternalWatcher / banner React root / event listener はすべて `onunload` / `view.onClose` で dispose
- **Public API の安定性**: AI エージェントが依存することを想定し、API は `version: 1` を明示。後方互換破壊時は `version: 2` を別 export して旧版を残す
- **Performance**: Vault に何千ファイルあっても event 購読は OK だが、event handler 内で重い処理 (read + parse) をしないこと。実 reload は view が前面のときのみ
- **Conflict UI の言語**: ユーザ言語 (Obsidian locale) に合わせる。最低限 `en` / `ja` 用意
- **Rename / Delete**: 開いている view のファイルが rename されたら view の file を更新、delete されたら view を閉じてユーザに Notice
