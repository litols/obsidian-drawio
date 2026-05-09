# 実装計画: drawio-external-sync

## タスク一覧

- [ ] 1. 設定スキーマ追加 (ExternalSyncSettings)
- [x] 1.1 `ExternalSyncSettings` 型と `DEFAULT_EXTERNAL_SYNC_SETTINGS` を `src/lib/settings.ts` に追加する
  - `ExternalSyncSettings` interface を定義: `autoReloadWhenClean`, `notifyOnExternalChange`, `notificationLevel`, `echoSuppressionMs`, `dedupDebounceMs`
  - `DrawioSettings` (drawio-settings-and-config 所有) に `externalSync: ExternalSyncSettings` フィールドを追加するための拡張を行う (本 spec が drawio-settings-and-config への additive coordination として実施)
  - `migrateSettings` (drawio-settings-and-config が定義) に **settingsVersion 1 → 2** の分岐を追加する: version === 1 (または `drawio.externalSync` 未定義) のときに `DEFAULT_EXTERNAL_SYNC_SETTINGS` を `drawio.externalSync` に補完し、`settingsVersion = 2` に bump する。1 → 2 以前の migration ロジック (legacy トップレベル吸収など) は drawio-settings-and-config 既存実装を再利用し書き換えない (chain pattern)
  - `DEFAULT_EXTERNAL_SYNC_SETTINGS` を export し `migrateSettings` から参照可能にする
  - migration テスト: `migrateSettings({ settingsVersion: 1, drawio: {...} })` が `settingsVersion: 2` と `drawio.externalSync = DEFAULT_EXTERNAL_SYNC_SETTINGS` を返すことを確認する
  - `ExternalSyncNotificationLevel` 型 (`'silent' | 'statusbar' | 'notice' | 'banner'`) を定義する
  - `DEFAULT_EXTERNAL_SYNC_SETTINGS` を定義し既定値を設定する
  - `DrawioSettings` インターフェースに `externalSync: ExternalSyncSettings` フィールドを追加する
  - `DEFAULT_DRAWIO_SETTINGS` を更新し `externalSync: DEFAULT_EXTERNAL_SYNC_SETTINGS` を含める
  - TypeScript 型チェック (`pnpm build`) がエラーなく通ることを確認する
  - _Requirements: 9.1, 9.2_
  - _Boundary: SettingsModule_

- [ ] 2. ExternalWatcher 実装
- [x] 2.1 `src/lib/external-watcher.ts` に `ExternalChangeEvent` 型と `ExternalWatcher` インターフェースを定義する (P)
  - `ExternalChangeEvent { file: TFile, mtime: number, sourceHint?: string }` を export する
  - `ExternalWatcher { registerSelfWrite(path): void; dispose(): void }` インターフェースを export する
  - 型定義のみのファイルとしてビルドエラーがないことを確認する
  - _Requirements: 2.1, 2.3_
  - _Boundary: ExternalWatcher_

- [x] 2.2 `createExternalWatcher` 関数を実装し Vault イベント購読・drawio 拡張子フィルタリング・event bus emit を行う
  - `vault.on('modify', ...)` / `vault.on('rename', ...)` / `vault.on('delete', ...)` を購読する
  - drawio 拡張子 (`.drawio` / `.drawio.svg` / `.drawio.png`) のみ処理する
  - modify イベント時: echo 抑制チェック (`recentSelfWrites` Map) を行う
  - echo 抑制を通過したイベントを `plugin.events.trigger('drawio:external-change', ExternalChangeEvent)` で発行する
  - `dispose()` で `vault.off(...)` を呼びすべてのリスナーを解除する
  - rename イベントで `event.oldPath` も `ExternalChangeEvent` に含め emit する
  - delete イベントで対象ファイルの情報を emit する
  - _Depends: 2.1_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 7.3, 11.1, 11.3_
  - _Boundary: ExternalWatcher_

- [x] 2.3 echo 抑制 (`registerSelfWrite`) と dedup debounce を実装する
  - `registerSelfWrite(path)` で `recentSelfWrites.set(path, Date.now())` し `echoSuppressionMs` 後に自動削除する
  - `modify` イベント時に `Date.now() - recentSelfWrites.get(path) < echoSuppressionMs` で判定して無視する
  - dedup: 同一 path の debounce timer を `pendingDebounce` Map で管理し `clearTimeout` + 新 `setTimeout` パターンを実装する
  - dedup 時間は `getSettings().externalSync.dedupDebounceMs` で毎回取得する
  - echo 抑制・dedup の単体テストシナリオを手動で確認できる状態にする
  - _Depends: 2.2_
  - _Requirements: 1.3, 1.4, 1.5, 1.6_
  - _Boundary: ExternalWatcher_

- [x] 2.4 3 段階通知 (statusbar / Notice) を ExternalWatcher に実装する
  - `addStatusBarItem()` で statusBarItem を生成し、`notificationLevel` が `'statusbar'` 以上のときに "Diagram updated externally" を表示する
  - `notifyOnExternalChange` が `false` の場合は通知を一切発火しない
  - `notificationLevel` が `'notice'` 以上のときに `new Notice(message)` を呼ぶ
  - `sourceHint` が存在する場合はメッセージに含める (例: "Diagram updated by Claude Code")
  - `dispose()` 時に statusBarItem を remove する
  - _Depends: 2.2_
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 9.4_
  - _Boundary: ExternalWatcher_

- [ ] 3. DrawioView への外部変更統合
- [x] 3.1 `src/views/DrawioView.ts` に `drawio:external-change` 購読と自動リロードロジックを追加する
  - `onLoadFile()` 内で `plugin.events.on('drawio:external-change', this.onExternalChange)` を購読する (EventRef を保持)
  - `onExternalChange` で `event.file.path === this.file?.path` を確認してから処理する
  - `isDirty === false` かつ `autoReloadWhenClean === true` の場合: `await this.reload(this.file)` を呼ぶ (drawio-file-io が提供する `DrawioView.reload(file, options?)` を利用; 内部で `readDrawioFile` → `bridge.load` → `currentFormat` / `currentCompressed` / `_isDirty` 更新まで完結する。`bridge.load` を直接呼ぶと内部状態が更新されないため禁止)
  - `reload()` が `DrawioDirtyReloadError` (drawio-file-io が export) を reject した場合 (race で dirty に変わったケース) は banner フローへフォールバックする
  - `readDrawioFile` 失敗時: drawio-file-io 内で `console.error` + `Notice` 表示済み (本 spec で再通知不要)
  - `onUnloadFile()` / `onClose()` で EventRef を解除する (購読していない場合は no-op)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 11.2_
  - _Boundary: DrawioView_

- [x] 3.2 rename / delete イベント時の DrawioView 対応を実装する
  - rename イベント受信時: `this.file` を新 TFile に更新する
  - delete イベント受信時: `this.leaf.detach()` で View を閉じ `new Notice('ダイアグラムが削除されました')` を発火する
  - rename/delete 判定は `ExternalChangeEvent` に付加した `type: 'rename' | 'delete' | 'modify'` フィールドで行う
  - _Depends: 3.1_
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: DrawioView_

- [ ] 4. Action Banner 実装
- [x] 4.1 `src/views/ExternalChangeBanner.tsx` に React コンポーネントを実装する (P)
  - `ExternalChangeBannerProps { sourceHint?, onReload, onDiff, onKeepMine }` を定義する
  - `[Reload]` / `[Diff]` / `[Keep mine]` ボタンを React JSX で実装する (`createElement` / JSX のみ、`innerHTML` 禁止)
  - `sourceHint` が存在する場合はメッセージに "外部で更新されました (sourceHint)" と表示する
  - Obsidian CSS variables を使用し視覚的にスタイルする
  - _Requirements: 5.1, 5.5_
  - _Boundary: ExternalChangeBanner_

- [x] 4.2 DrawioView に banner mount / unmount ロジックを追加する
  - `onExternalChange` 内で `isDirty === true` の場合に banner 専用 `div` を生成し `createRoot` でマウントする
  - 既存 banner が存在する場合は `root.render(...)` で更新する (重複 root 生成しない)
  - `onClose()` / `onUnloadFile()` で banner React root を unmount し container div を remove する
  - banner の `onReload` コールバックで `await this.reload(this.file, { force: true })` (drawio-file-io API) → banner unmount を実行する。`bridge.load` を直接呼ばず、必ず `reload(..., { force: true })` 経由で `_isDirty` / `_lastXml` / `currentFormat` をリセットする
  - banner の `onKeepMine` コールバックで確認 Modal → `writeDrawioFile(currentXml)` → banner unmount を実行する
  - _Depends: 4.1, 3.1_
  - _Requirements: 5.1, 5.2, 5.4, 5.6, 5.7_
  - _Boundary: DrawioView, ExternalChangeBanner_

- [ ] 5. Diff Modal 実装
- [x] 5.1 `src/views/DiffModal.tsx` に Obsidian Modal + React の Diff Modal を実装する
  - `DiffModal` クラスが `Modal` を継承し `onOpen()` / `onClose()` を実装する
  - `onOpen()` で container に React root をマウントし `currentXml` / `latestXml` の diff を表示する
  - `@codemirror/merge` を `import()` 遅延ロードで試み、失敗時は行単位の簡易 diff にフォールバックする
  - `[Reload]` / `[Keep mine]` アクションボタンを提供する
  - `onClose()` で React root を unmount する
  - `innerHTML` を使用しない
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - _Boundary: DiffModal_

- [x] 5.2 DrawioView の banner `[Diff]` ボタンから DiffModal を呼び出す配線を実装する
  - `onDiff` コールバック内で現在 iframe 内 XML を取得する (`bridge.requestExport('xml')` を使用)
  - `readDrawioFile(this.file)` で Vault 最新 XML を取得する
  - `new DiffModal(app, currentXml, latestXml, onReload, onKeepMine).open()` を呼ぶ
  - _Depends: 5.1, 4.2_
  - _Requirements: 5.3, 6.1_
  - _Boundary: DrawioView, DiffModal_

- [ ] 6. Public API 実装
- [x] 6.1 `src/lib/plugin-api.ts` に `DrawioPublicApi` インターフェースと `createDrawioPluginApi` 関数を実装する
  - `DrawioPublicApi { version: 1, getDiagramXml, setDiagramXml, requestReload, subscribe }` を定義・実装する
  - `getDiagramXml`: `readDrawioFile(file, vault)` を呼び XML を返す
  - `setDiagramXml`: `writeDrawioFile` で書き込み後に `plugin.events.trigger('drawio:external-change', ...)` を発行する
  - `requestReload`: `app.workspace` で対象ファイルを開いている DrawioView を探し `reload()` を呼ぶ
  - `subscribe`: `plugin.events.on('drawio:external-change', listener)` のラッパーを返す; 戻り値は unsubscribe 関数
  - `isDead` フラグで `onunload()` 後の呼び出しを reject / no-op にする
  - `opts.reason` が指定された場合は `sourceHint` として `ExternalChangeEvent` に含める
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - _Boundary: DrawioPluginApi_

- [ ] 7. Plugin エントリポイントへの統合
- [x] 7.1 `src/main.ts` に ExternalWatcher・DrawioPluginApi・コマンドを登録する
  - `onload()` で `createExternalWatcher(this, this.app.vault, () => this.settings.drawio.externalSync)` を生成する
  - `onload()` で `this.api = createDrawioPluginApi(this, externalWatcher)` を設定する
  - "Refresh diagram from disk" コマンドを `this.addCommand({ id: 'drawio-refresh-from-disk', name: '...', callback: ... })` で登録する
  - コマンドのコールバック内でアクティブな DrawioView を取得し `reload()` を呼ぶ
  - `onunload()` で `externalWatcher.dispose()` を呼ぶ
  - TypeScript ビルドが通ることを確認する
  - _Depends: 2.2, 6.1_
  - _Requirements: 10.1, 10.2, 10.3, 11.1, 11.3_
  - _Boundary: ObsidianDrawioPlugin_

- [ ] 8. 検証とクリーンアップ
- [x] 8.1 外部変更の基本フロー (not dirty → 自動リロード) を手動検証する
  - Obsidian Desktop で `.drawio` ファイルを開く
  - CLI で XML を書き換える (例: `echo '<mxfile>...</mxfile>' > test.drawio`)
  - 自動リロードされ iframe の内容が更新されることを確認する
  - status bar / Notice が設定どおりに表示されることを確認する
  - _Requirements: 3.1, 3.2, 4.1, 4.2_

- [x] 8.2 衝突解消 UI フロー (dirty → banner) を手動検証する
  - iframe 内で図を編集 (dirty 状態) にする
  - 外部から XML を書き換える
  - banner が表示されることを確認する
  - `[Reload]` / `[Diff]` / `[Keep mine]` の各ボタンが期待通りに動作することを確認する
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1_

- [x] 8.3 Public API の動作を手動検証する
  - Obsidian の Developer Console で `app.plugins.plugins['obsidian-drawio'].api.getDiagramXml(file)` を実行し XML が返ることを確認する
  - `api.setDiagramXml(file, xml, { reason: 'test' })` で View が更新され "updated by test" の通知が出ることを確認する
  - `api.version` が `1` であることを確認する
  - _Requirements: 8.1, 8.2, 8.3, 8.6, 8.7_

- [x] 8.4 リソースリークがないことを確認する
  - プラグインをアンロード後に Developer Console でメモリ参照が残っていないことを確認する
  - View を閉じた後に `drawio:external-change` リスナーが解除されていることをログで確認する
  - ExternalWatcher の `dispose()` が複数回呼んでも例外が出ないことを確認する
  - _Requirements: 11.1, 11.2, 11.3, 11.4_
