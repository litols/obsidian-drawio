# 要件ドキュメント: drawio-external-sync

## はじめに

Obsidian Vault 内の `.drawio` / `.drawio.svg` / `.drawio.png` ファイルは Obsidian の外部からも変更される。具体的には AI エージェント (Claude Code 等)、CLI ツール、Git pull、ファイル同期サービス (iCloud/Dropbox/Syncthing)、または drawio-desktop などの別の編集ツールが同じファイルを書き換えうる。現状の `DrawioView` は `onLoadFile` 時にのみ XML を読み込み、その後は drawio iframe 内の状態が source of truth となるため、外部変更があっても通知もリロードもされず、最悪の場合 View が古い XML を保存し直して外部変更を上書きする。

本 spec は外部変更を検知し、ユーザーに通知し、クリーンな状態では自動リロード、ダーティ状態では衝突解消 UI を提示することで、AI エージェントと人間の協働ワークフローにおける安全性を確保する。また、AI エージェントが Obsidian 外から図を更新した後、Obsidian 側へ通知・再読み込みを依頼できる Public API を公開する。

## バウンダリコンテキスト

- **スコープ内**: Vault イベント購読 (modify/rename/delete) と self-write echo 抑制、DrawioView への通知・リロード・衝突解消 UI 統合、3 段階通知 (status bar / Notice / view banner)、Diff modal、Public API (getDiagramXml / setDiagramXml / requestReload / subscribe)、PluginSettings への設定スキーマ追加
- **スコープ外**: 3-way merge・セマンティック diff、drawio iframe 内 visual diff overlay、リアルタイム共同編集、Git 統合、クラウドストレージ独自 API、AI エージェント側のロジック、Mobile 環境
- **隣接仕様への期待**: drawio-file-io の `DrawioView.isDirty` / `reload()` / `readDrawioFile` を消費する。drawio-embed-bridge の `DrawioBridge.load(xml)` を呼び出す。drawio-settings-and-config は本 spec が追加する設定スキーマの UI を実装する

---

## 要件

### 要件 1: 外部変更検知

**目的:** Obsidian デスクトップユーザーとして、Vault 内の drawio ファイルが Obsidian 外から変更されたことを検知したい。そうすることで、外部変更に気づかず古い内容を上書きする事故を防止できる。

#### 受入基準

1. When Obsidian の `Vault.on('modify')` / `'rename'` / `'delete'` イベントが発火された場合、the Plugin shall 対象ファイルが `.drawio` / `.drawio.svg` / `.drawio.png` 拡張子を持つかを判定する
2. When 変更検知対象ファイルが `.drawio` / `.drawio.svg` / `.drawio.png` である場合、the Plugin shall そのイベントを処理候補として扱う
3. When プラグイン自身が直近に書き込んだファイルが `Vault.on('modify')` で通知される場合、the Plugin shall echo 抑制ウィンドウ内 (既定 300ms、設定可能) に書き込み記録が存在するなら当該イベントを無視する
4. When 同一ファイルに対して短時間内 (既定 100ms debounce) に複数の modify イベントが発火する場合、the Plugin shall 最後のイベントのみを処理する (dedup)
5. The Plugin shall echo 抑制の時間窓 (echoSuppressionMs) を PluginSettings 経由で設定可能にする
6. The Plugin shall dedup debounce 時間 (dedupDebounceMs) を PluginSettings 経由で設定可能にする

---

### 要件 2: 外部変更イベントの伝播

**目的:** プラグイン内の各コンポーネント (DrawioView、Public API 消費者) として、外部変更イベントを受信したい。そうすることで、各コンポーネントが適切な対応 (通知・リロード・API コールバック) を取ることができる。

#### 受入基準

1. When 外部変更が echo 抑制・dedup を通過した場合、the Plugin shall `ExternalChangeEvent { file: TFile, mtime: number, sourceHint?: string }` を plugin の event bus (`plugin.events`) に `drawio:external-change` として emit する
2. When `drawio:external-change` イベントが emit される場合、the Plugin shall 現在開いている DrawioView のうち対象ファイルと一致するものに通知が届くようにする
3. The Plugin shall `plugin.events.on('drawio:external-change', callback)` でリスナーを登録できる API を提供する
4. The Plugin shall `onunload()` 時にすべての event listener を解除する

---

### 要件 3: ダーティ判定と自動リロード

**目的:** Obsidian デスクトップユーザーとして、drawio View が未編集 (not dirty) であるときは外部変更を自動的に反映したい。そうすることで、手動操作なしに常に最新のファイル内容を確認できる。

#### 受入基準

1. When 外部変更通知を受信した DrawioView の `isDirty` が `false` の場合 and `autoReloadWhenClean` 設定が `true` の場合、the Plugin shall drawio-file-io が提供する `DrawioView.reload(this.file)` を呼び出して iframe を最新 XML で更新する (`reload` 内部で `readDrawioFile` → `DrawioBridge.load(xml)` → `currentFormat` / `_isDirty` / `_lastXml` 更新まで実施される。`DrawioBridge.load` の直接呼び出しは内部状態が同期されないため禁止)
2. When 自動リロードが実行された場合、the Plugin shall `notifyOnExternalChange` が `true` の場合に `notificationLevel` に応じた通知を発火する
3. If 自動リロード中に `readDrawioFile` が失敗した場合、the Plugin shall `console.error` でログし Obsidian `Notice` でユーザーに通知する
4. Where `autoReloadWhenClean` 設定が `false` の場合、the Plugin shall 自動リロードせず、代わりにバナー表示へフォールバックする

---

### 要件 4: 3 段階通知

**目的:** Obsidian デスクトップユーザーとして、外部変更の通知を好みのレベルで受け取りたい。そうすることで、ワークフローの邪魔にならない範囲で変更を把握できる。

#### 受入基準

1. Where `notificationLevel` が `'statusbar'` 以上の場合、the Plugin shall Obsidian の `addStatusBarItem()` で取得したステータスバーアイテムに "Diagram updated externally" のテキストを恒常表示する
2. Where `notificationLevel` が `'notice'` 以上の場合、the Plugin shall `new Notice(message)` で右上トースト通知を発火する
3. Where `notificationLevel` が `'banner'` の場合、the Plugin shall DrawioView 内に action banner を表示する (詳細は要件 5 参照)
4. Where `notificationLevel` が `'silent'` の場合、the Plugin shall 通知を一切表示しない
5. The Plugin shall 通知メッセージに `ExternalChangeEvent.sourceHint` が存在する場合はその内容 (例: "Diagram updated by Claude Code") を表示する

---

### 要件 5: 衝突解消 UI (Action Banner)

**目的:** Obsidian デスクトップユーザーとして、drawio View が dirty 状態のときに外部変更が来た場合、3 つの選択肢から対応を選びたい。そうすることで、未保存の変更と外部変更の衝突を安全に解消できる。

#### 受入基準

1. When 外部変更通知を受信した DrawioView の `isDirty` が `true` の場合、the Plugin shall View 内に `[Reload] [Diff] [Keep mine]` ボタンを持つ action banner を表示する
2. When ユーザーが `[Reload]` を押した場合、the Plugin shall drawio-file-io の `DrawioView.reload(file, { force: true })` を呼び出して Vault の最新 XML を再投入し、`_isDirty` / `_lastXml` / `currentFormat` を一括リセットしてから banner を非表示にする
3. When ユーザーが `[Diff]` を押した場合、the Plugin shall 現在の iframe 内 XML と Vault の最新 XML をテキスト diff 表示する Modal を開く
4. When ユーザーが `[Keep mine]` を押した場合、the Plugin shall 確認 Modal を 1 段挟み、確認後に現在の iframe 内 XML を Vault に保存し外部変更を破棄する
5. The Plugin shall action banner を `createElement` または React `createRoot` で生成し `innerHTML` を使用しない
6. When DrawioView が閉じられる場合 (`onClose`)、the Plugin shall banner を確実に unmount する
7. If 同一 View に複数の外部変更が重複して届く場合、the Plugin shall banner は 1 つのみ表示し既存 banner を更新する

---

### 要件 6: Diff Modal

**目的:** Obsidian デスクトップユーザーとして、現在の編集内容と外部変更後のファイルの差分を視覚的に確認したい。そうすることで、どちらを採用するか判断できる。

#### 受入基準

1. When Diff Modal が開かれる場合、the Plugin shall 現在の iframe 内 XML (before) と Vault 最新 XML (after) を行単位で diff 表示する
2. The Plugin shall Diff Modal は Obsidian の `Modal` を継承し、React で内部を実装する
3. The Plugin shall diff 表示は `@codemirror/merge` (mergeView) または軽量な行 diff アルゴリズムを使用する
4. When Diff Modal が閉じられる場合、the Plugin shall React root を unmount する
5. The Plugin shall Diff Modal 内に `[Reload]` と `[Keep mine]` のアクションボタンを提供する

---

### 要件 7: rename / delete への対応

**目的:** Obsidian デスクトップユーザーとして、開いている drawio ファイルが外部から rename または delete された場合、適切な通知を受け取りたい。そうすることで、消えたファイルに対して誤って編集を続けることを防止できる。

#### 受入基準

1. When 開いている DrawioView のファイルが Vault の `rename` イベントで新しいパスに変更された場合、the Plugin shall DrawioView の内部ファイル参照を新パスに更新する
2. When 開いている DrawioView のファイルが Vault の `delete` イベントで削除された場合、the Plugin shall DrawioView を閉じ `new Notice('...')` でユーザーに通知する
3. When rename / delete イベントが処理される場合、the Plugin shall echo 抑制の対象外として必ず処理する (rename/delete はプラグイン自身が発生させない)

---

### 要件 8: Public API

**目的:** AI エージェント (Claude Code 等) として、`app.plugins.plugins['obsidian-drawio'].api` 経由で drawio ファイルの XML を取得・置換・再読み込み依頼をしたい。そうすることで、Obsidian と AI ワークフローをシームレスに連携できる。

#### 受入基準

1. The Plugin shall `plugin.api` として以下の Public API を `app.plugins.plugins['<id>'].api` 経由で外部から取得できるようにする
2. The Plugin shall `api.getDiagramXml(file: TFile): Promise<string>` で対象ファイルの現在 XML を返す
3. The Plugin shall `api.setDiagramXml(file: TFile, xml: string, opts?: { reason?: string }): Promise<void>` で Vault へ XML を書き込み、開いている View に外部変更通知を届ける
4. The Plugin shall `api.requestReload(file: TFile): Promise<void>` で対象ファイルを開いている DrawioView に再読み込みを要求する
5. The Plugin shall `api.subscribe(listener: (event: ExternalChangeEvent) => void): () => void` で変更イベントのリスナーを登録できる (戻り値: unsubscribe 関数)
6. The Plugin shall `api.version: number` (初期値: `1`) を公開し、後方互換破壊時は `2` に更新する
7. When `setDiagramXml` が呼ばれる場合で `opts.reason` が指定されている場合、the Plugin shall 通知メッセージに `reason` の内容を含める (例: "Diagram updated by Claude Code")
8. The Plugin shall Public API の各メソッドは `onunload()` 後に呼ばれた場合でも例外を throw せず reject または no-op で応答する

---

### 要件 9: 設定スキーマ

**目的:** Obsidian デスクトップユーザーとして、外部変更同期の動作をグローバル設定で制御したい。そうすることで、ワークフローに合ったバランスで自動処理と通知を調整できる。

#### 受入基準

1. The Plugin shall `PluginSettings` の `drawio.externalSync` 名前空間に以下のフィールドを追加する: `autoReloadWhenClean: boolean` (既定: `true`)、`notifyOnExternalChange: boolean` (既定: `true`)、`notificationLevel: 'silent' | 'statusbar' | 'notice' | 'banner'` (既定: `'banner'`)、`echoSuppressionMs: number` (既定: `300`)、`dedupDebounceMs: number` (既定: `100`)
2. The Plugin shall 上記スキーマを `DEFAULT_DRAWIO_SETTINGS` に反映し、既存の設定データとの後方互換を維持する
3. The Plugin shall drawio-settings-and-config の `SettingsTab` が `<section data-spec="external-sync">` に外部同期設定 UI を追加できる拡張ポイントを確保する (UI の実装は drawio-settings-and-config spec が行う)
4. Where `notifyOnExternalChange` が `false` の場合、the Plugin shall 通知を一切発火しない (notificationLevel に関わらず)

---

### 要件 10: Obsidian コマンド

**目的:** Obsidian デスクトップユーザーおよび AI エージェントとして、コマンドパレットから drawio ファイルの再読み込みと外部変更イベントの手動発火を行いたい。

#### 受入基準

1. The Plugin shall "Refresh diagram from disk" コマンドをコマンドパレットに登録する
2. When "Refresh diagram from disk" コマンドが実行される場合 and アクティブな DrawioView が存在する場合、the Plugin shall 対象 View を強制リロードする
3. The Plugin shall コマンドの登録/解除は Obsidian の `addCommand()` / `onunload()` 自動解除機構を利用する

---

### 要件 11: リソース管理とクリーンアップ

**目的:** Obsidian デスクトップユーザーとして、プラグインのアンロード時にリソースが確実に解放されることを期待する。そうすることで、メモリリークや zombie リスナーが発生しない。

#### 受入基準

1. When `ObsidianDrawioPlugin.onunload()` が呼ばれる場合、the Plugin shall ExternalWatcher の Vault イベントリスナーをすべて解除する
2. When `DrawioView.onClose()` が呼ばれる場合、the Plugin shall 当該 View の `drawio:external-change` 購読・banner React root を unmount する
3. The Plugin shall `ExternalWatcher` のインスタンスは Plugin につき 1 つのみ生成し、`onunload()` で破棄する
4. When Diff Modal が閉じられる場合、the Plugin shall Modal の React root を unmount する
