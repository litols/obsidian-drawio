# 実装計画: drawio-settings-and-config

> 改訂メモ (2026-05-10): per-diagram 設定機能の撤去に伴い、旧 2.x (per-diagram 永続化) / 旧 5.x (DiagramSettingsModal) のタスク群を削除し、既存実装の撤去クリーンアップタスクを追加した。番号は通し番号で振り直し済み。

- [ ] 1. 設定スキーマ基盤の確立
- [x] 1.1 DrawioSettings 型・DEFAULT_SETTINGS・PluginSettings 拡張を定義する
  - `src/lib/settings.ts` に `DrawioTheme`、`DrawioLanguage`、`DrawioSaveFormat`、`DrawioSettings` interface を追加する
  - `DEFAULT_DRAWIO_SETTINGS` オブジェクトを定義する (theme: 'auto', defaultLibraries: ['general'], 他すべてのデフォルト値)
  - `plugin-foundation` が空 interface で公開する `PluginSettings` を declaration merging (`declare module './settings' { interface PluginSettings { drawio: DrawioSettings } }`) で拡張する。`[key: string]: unknown` のような index signature は導入しない
  - 必要なら本 spec 内コンシューマ向けに `type DrawioPluginSettings = PluginSettings & { drawio: DrawioSettings }` を内部エイリアスとして提供してよい (公開 API ではない)
  - `tsc --noEmit` でエラーゼロが確認できること
  - _Requirements: 1.1, 1.4, 1.5_
  - _Boundary: SettingsModule_

- [x] 1.2 migrateSettings 関数を実装する
  - `migrateSettings(raw: unknown): DrawioSettings` を `src/lib/settings.ts` に追加する
  - `raw` が null / 非 object の場合は `DEFAULT_DRAWIO_SETTINGS` を返す
  - `settingsVersion` が 0 または undefined の場合にすべての欠損フィールドを DEFAULT で補完する
  - **Legacy トップレベルフィールド (drawio-file-io が追加した) を吸収する**: raw に `openDrawioSvg` / `openDrawioPng` / `preserveCompression` がトップレベルに存在する場合、それぞれ `drawio.openDrawioSvg` / `drawio.openDrawioPng` / `drawio.compression` に移動し、トップレベルからは削除する
  - `settingsVersion` を最新値 (1) に更新して返す
  - `migrateSettings` が throw しないことを確認できること (null、空オブジェクト、型不一致フィールドを渡してもエラーにならない)
  - レガシーフィールド吸収のテストケース (file-io 単独で生成した data.json をマイグレートするとフィールドが drawio 名前空間下に移動していること) を確認できること
  - _Requirements: 1.2, 1.3, 1.6, 1.7, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: SettingsModule_

- [x] 1.3 resolveBridgeTheme helper を実装する
  - `src/lib/theme-bridge.ts` (または `src/lib/settings.ts`) に `resolveBridgeTheme(setting: DrawioTheme, currentObsidianTheme: 'light' | 'dark'): { setTheme: 'light' | 'dark'; uiVariant?: 'kennedy' | 'min' | 'atlas' | 'dark' }` を追加する
  - design.md のマッピング表に従って実装する (auto → currentObsidianTheme、light/kennedy/min/atlas → 'light' + 該当 uiVariant、dark → 'dark')
  - 全 6 ケース (auto-light, auto-dark, light, dark, kennedy, min, atlas) のテーブル駆動ユニットテストが pass すること
  - _Requirements: 3.5, 3.6_
  - _Boundary: ThemeBridge, SettingsModule_
  - _Depends: 1.1_

- [ ] 2. ThemeBridge の実装
- [x] 2.1 ThemeBridge モジュールを実装する
  - `src/lib/theme-bridge.ts` を新規作成する
  - `ThemeBridge` interface (`registerBridge`, `unregisterBridge`, `applyTheme`, `dispose`) を定義する
  - `createThemeBridge(plugin, getSettings)` ファクトリ関数を実装する
  - `subscribeThemeChange` で css-change を購読し、`theme === 'auto'` のときのみ全登録 bridge に `setTheme` を呼ぶ
  - `applyTheme(bridge)` 内で `resolveBridgeTheme()` を呼び、`bridge.setTheme(setTheme)` に加え `uiVariant` がある場合は `bridge.sendMessage({ action: 'configure', config: { ui: uiVariant } })` も送信する
  - `theme === 'auto'` のとき css-change で `DrawioBridge.setTheme` が呼ばれること、`theme === 'dark'` のとき css-change が無視されること、`theme === 'kennedy'` のとき mount 時に `setTheme('light')` と `configure { ui: 'kennedy' }` が両方呼ばれることを確認できること
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_
  - _Boundary: ThemeBridge_
  - _Depends: 1.3_

- [x] 2.2 DrawioView マウント時の初回テーマ適用を実装する
  - `ThemeBridge.applyTheme(bridge)` を DrawioView の mount 後に呼ぶ配線を `src/main.ts` に追加する (drawio-file-io の DrawioView が bridge を公開することを前提とする)
  - 固定テーマの場合はそのテーマ値で、`auto` の場合は `getCurrentTheme()` の戻り値で `setTheme` が呼ばれることを確認できること
  - _Requirements: 3.2, 3.3_
  - _Boundary: ThemeBridge_
  - _Depends: 2.1_

- [ ] 3. DrawioSettingTab (グローバル設定 UI) の実装
- [x] 3.1 DrawioSettingTab クラスと React ルートの骨格を実装する
  - `src/views/SettingsTab.tsx` を新規作成する
  - `DrawioSettingTab extends PluginSettingTab` を定義し、`display()` で `mountManager.mount`、`hide()` で `mountManager.unmount` を呼ぶ
  - `SettingsApp` React コンポーネントの骨格 (空の `<div>`) を実装する
  - `src/main.ts` の `onload()` に `this.addSettingTab(new DrawioSettingTab(app, this))` を追加する
  - Obsidian 設定画面で "draw.io" タブが表示され、設定画面を閉じると React が unmount されること (DevTools で確認)
  - _Requirements: 2.1, 2.12_
  - _Boundary: DrawioSettingTab_
  - _Depends: 1.1_

- [x] 3.2 テーマ・保存形式・圧縮・math・grid・ribbon 設定の UI を実装する (P)
  - `SettingsApp` に theme ドロップダウン (auto/light/dark/kennedy/min/atlas) を実装する
  - `defaultSaveFormat` ドロップダウン (keep/drawio) を実装する
  - `compression`・`math`・`grid`・`ribbonEnabled` トグルを実装する
  - 各コントロール変更時に `saveSettings` が呼ばれること、ページ再読み込み後に値が保持されることを確認できること
  - _Requirements: 2.2, 2.5, 2.6, 2.7, 2.9, 2.10, 2.11_
  - _Boundary: DrawioSettingTab_
  - _Depends: 3.1_

- [x] 3.3 libraries 設定 UI (デフォルト・カスタム) を実装する (P)
  - defaultLibraries チェックボックス群 (general, basic, arrows3, flowchart, uml, er, bpmn, mockup, network, lean_mapping) を実装する
  - customLibraries の追加/削除リスト UI を実装する (Vault 相対パスのみ受け付ける)
  - 入力検証: `http://`, `https://`, `file://`, `app://` で始まる文字列、または `://` を含む文字列を入力時に拒否しインラインエラーメッセージを表示する; 絶対パス (`/...`, Windows の `C:\\...`) も拒否する
  - 各操作後に `saveSettings` が呼ばれること、設定値が保持されること、外部 URL を入力すると配列に追加されないことを確認できること
  - _Requirements: 2.3, 2.4, 2.11_
  - _Boundary: DrawioSettingTab_
  - _Depends: 3.1_

- [x] 3.4 LibraryBridge: customLibraries (Vault 相対パス) を `DrawioBridge.setLibraries` の引数形式に変換するヘルパーを実装する
  - `src/lib/library-bridge.ts` を新規作成する (本 spec が責務を持つ; drawio-file-io には移譲しない理由は UI と直結しているため)
  - `loadCustomLibraries(vault: Vault, paths: string[]): Promise<ReadonlyArray<{ title: string; entries: unknown[] }>>` を実装する: 各パスを `vault.adapter.read` で読み込み、ファイル拡張子に応じて drawio library XML (`<mxlibrary>...</mxlibrary>` の JSON 配列) としてパースし、`{ title: ファイル basename, entries: 配列 }` を返す。読み込み/パース失敗時は当該パスを skip し `console.warn` でログ
  - `applyLibraries(bridge: DrawioBridge, settings: DrawioSettings, vault: Vault): Promise<void>` を実装する: `defaultLibraries` (settings 名) はそのまま `setLibraries` の引数に追加 (entries は drawio embed 側がデフォルト解決)、`customLibraries` (Vault 相対パス) は `loadCustomLibraries` で entries 解決後に追加し、最終的に `bridge.setLibraries([...defaults, ...customs])` を 1 回呼ぶ
  - DrawioView の mount 完了後に `applyLibraries(bridge, settings.drawio, vault)` を呼ぶ配線を `src/main.ts` に追加する (drawio-file-io が DrawioView を公開する前提)
  - 設定で customLibraries を追加→保存→ DrawioView を再 mount した際に library entries が drawio shape panel に反映されることを手動検証できること
  - _Requirements: 2.3, 2.4_
  - _Boundary: LibraryBridge, SettingsModule_
  - _Depends: 3.3, 1.1_

- [x] 3.5 言語設定 UI を実装する (P)
  - `language` ドロップダウン (auto + 対応言語コード一覧) を実装する
  - `language === 'auto'` 時に `moment.locale()` から drawio 言語コードを解決するヘルパー関数を実装する (先頭 2 文字マッチ + en フォールバック)
  - ドロップダウン変更後に `saveSettings` が呼ばれること、`auto` 設定時に DrawioView の iframe URL に正しい `lang` パラメータが渡されることを確認できること
  - _Requirements: 2.8, 2.11, 4.1, 4.2, 4.3_
  - _Boundary: DrawioSettingTab, SettingsModule_
  - _Depends: 3.1_

- [x] 3.6 external-sync 設定セクションの予約 UI を実装する
  - `SettingsApp` の末尾に `<section data-spec="external-sync">` セクションを追加する
  - セクションヘッダー "外部変更の同期設定 (external-sync spec により追加)" とプレースホルダーテキストを表示する
  - `drawio-external-sync` spec が設定コンポーネントを注入できる拡張ポイントが確認できること
  - _Requirements: 2.13_
  - _Boundary: DrawioSettingTab_
  - _Depends: 3.1_

- [ ] 4. onload / onunload の配線と統合
- [x] 4.1 onload への ThemeBridge・SettingTab 登録を追加する
  - `src/main.ts` の `onload()` に `createThemeBridge` の初期化、`addSettingTab` を追加する
  - `loadSettings` 後に `migrateSettings` を呼んで設定を最新スキーマに正規化し、変更があれば `saveSettings` を呼ぶ (legacy file-io トップレベルフィールドの吸収を含む)
  - プラグイン有効化後に設定タブが表示され、テーマ追従が動作することを確認できること
  - _Requirements: 1.3, 1.6, 2.1, 3.4_
  - _Boundary: SettingsModule, ThemeBridge, DrawioSettingTab_
  - _Depends: 1.2, 2.1, 3.1_

- [x] 4.2 onunload での ThemeBridge dispose を追加する
  - `src/main.ts` の `onunload()` に `themeBridge.dispose()` の呼び出しを追加する
  - プラグイン無効化後に css-change リスナーが解除されていること (console に警告が出ないこと)
  - _Requirements: 3.4_
  - _Boundary: ThemeBridge_
  - _Depends: 4.1_

- [ ] 5. per-diagram 設定機能の撤去 (クリーンアップ)
- [ ] 5.1 per-diagram-config モジュールと sidecar lifecycle hook を削除する
  - `src/lib/per-diagram-config.ts` をリポジトリから削除する
  - `src/main.ts` から `registerPerDiagramConfigLifecycle(this)` の呼び出しと関連 import を削除する
  - `vault.on('rename', ...)` / `vault.on('delete', ...)` のうち sidecar 同期目的で登録されているハンドラをすべて除去する (他用途のリスナーは維持)
  - 削除後に `tsc --noEmit` がエラーゼロで通ること、関連 import 漏れがないこと
  - _Requirements: (撤去対応; 旧要件 4 削除に追従)_
  - _Boundary: SettingsModule, PluginEntry_

- [ ] 5.2 DiagramSettingsModal と関連コマンドを削除する
  - `src/views/DiagramSettingsModal.tsx` をリポジトリから削除する
  - `src/main.ts` の `addCommand("drawio: 図の設定を編集", ...)` 登録を削除し、関連 import を除去する
  - コマンドパレットから "drawio: 図の設定を編集" が消えていることを手動確認できること
  - _Requirements: (撤去対応; 旧要件 5 削除に追従)_
  - _Boundary: PluginEntry_

- [ ] 5.3 設定マージ関数から per-diagram レイヤを除去する
  - `getMergedSettings` 等、グローバル設定と per-diagram config をマージしていた関数を、グローバル設定 (`settings.drawio`) を直接返す形に簡略化するか、コール元が `settings.drawio` を直接参照するよう書き換える
  - drawio-file-io / theme-bridge / library-bridge 等のコンシューマが `PerDiagramConfig` を参照していないことを確認できること (grep で `PerDiagramConfig` ヒットゼロ)
  - 単体テストの中で per-diagram マージ挙動を assert している箇所を撤去する
  - _Requirements: (撤去対応)_
  - _Boundary: SettingsModule_
  - _Depends: 5.1, 5.2_

- [ ] 5.4 per-diagram 関連の自動テストを削除する
  - `loadPerDiagramConfig` / `savePerDiagramConfig` / `sidecarPath` / sidecar lifecycle / DiagramSettingsModal を対象とする unit / integration テストファイルおよびケースを削除する
  - 削除後にテストスイート全体 (`npm test` 等) が pass すること
  - _Requirements: (撤去対応)_
  - _Boundary: SettingsModule_
  - _Depends: 5.1, 5.2, 5.3_

- [ ] 6. 検証・統合テスト
- [x] 6.1 設定スキーマのユニットテスト
  - `migrateSettings(null)` → DEFAULT、`migrateSettings({settingsVersion: 0})` → 全フィールド補完、`migrateSettings({theme: 999})` → theme DEFAULT にリセットを確認する
  - **Legacy 吸収テスト**: `migrateSettings({openDrawioSvg: false, openDrawioPng: false, preserveCompression: false})` が `{ drawio: { openDrawioSvg: false, openDrawioPng: false, compression: false, ... } }` を返し、トップレベルのレガシーフィールドが消えていることを確認する
  - `resolveBridgeTheme` のテーブル駆動テスト (auto-light, auto-dark, light, dark, kennedy, min, atlas) を実施する
  - すべてのテストケースが pass すること
  - _Requirements: 1.2, 1.3, 1.6, 3.5, 3.6, 5.1, 5.2, 5.3_

- [ ]* 6.2 E2E 手動検証 (Obsidian Desktop)
  - Obsidian 設定画面で全設定項目が変更・保存・再起動後に保持されていることを確認する
  - Obsidian テーマを light/dark に切り替えたとき draw.io iframe のテーマが追従することを確認する
  - per-diagram 機能が完全に消えており、コマンドパレットに "drawio: 図の設定を編集" が出ないこと、`<file>.drawio.json` を作成しても無視されることを確認する
  - _Requirements: 2.1, 2.2, 2.11, 3.1, 3.3_

---

Last revised: 2026-05-10 — per-diagram 設定機能撤去 (旧 2.x / 5.x タスク削除、撤去クリーンアップタスク 5.1〜5.4 追加、通し番号で再採番)
