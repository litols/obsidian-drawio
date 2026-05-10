# 要件定義書: drawio-settings-and-config

## はじめに

Obsidian で draw.io ダイアグラムを編集するユーザーは、テーマ・shape library・保存形式・言語などの動作を GUI から設定する手段を持っていない。本機能は以下を実現する:

- `PluginSettingTab` (React) によるグローバル設定 UI
- Obsidian テーマ追従 (`css-change` イベント → `DrawioBridge.setTheme()`)
- 設定スキーマのバージョン管理 (`settingsVersion`)
- `drawio-external-sync` spec が追加する設定キーの統合ポイント (UI のみ担当、スキーマ定義は external-sync spec が行う)

なお、図ファイル単位 (per-diagram) の設定上書き機能は本 spec のスコープから撤去された (Phase 2 ロードマップ判断: sidecar 案・mxfile 埋め込み案ともに採用しない)。グローバル設定のみで動作する単純なモデルに統一する。

## バウンダリコンテキスト

- **対象**: `PluginSettings` の拡張、グローバル設定 UI、テーマ追従の配線
- **対象外**: `DrawioBridge` API 自体の追加 (drawio-embed-bridge 担当)、ファイルフォーマット reader/writer (drawio-file-io 担当)、drawio webapp 本体の改造、図ファイル単位の設定上書き (機能撤去)
- **隣接期待**: drawio-embed-bridge が `setTheme` / `setLibraries` / `sendMessage` API を提供すること。drawio-file-io はグローバル設定のみを参照して `DrawioView` を構成すること

## 要件

### 要件 1: グローバル設定スキーマ

**目的:** Obsidian プラグインユーザーとして、テーマ・shape library・保存形式など drawio の動作設定を型安全かつバージョン管理された形式で永続化できるようにしたい。そうすることで Obsidian の再起動やバージョンアップ後も設定が保持される。

#### 受け入れ基準

1. The plugin shall extend `PluginSettings` (defined in `plugin-foundation`) with a `drawio` namespace field containing all drawio-specific settings, without breaking the existing `PluginSettings` contract.
2. The plugin shall include a `settingsVersion` number field in the `drawio` namespace to identify the schema version for future migration.
3. When `settingsVersion` is absent or lower than the current version in stored data, the plugin shall migrate settings to the current schema using a migration function and save the updated data.
4. The plugin shall provide `DEFAULT_SETTINGS` values for all new fields: `theme: 'auto'`, `defaultLibraries: ['general']`, `customLibraries: []`, `defaultSaveFormat: 'keep'`, `compression: true` (drawio-file-io legacy `preserveCompression: true` を継承), `math: false`, `language: 'auto'`, `grid: true`, `ribbonEnabled: true`.
5. The plugin shall expose a `DrawioSettings` TypeScript interface with explicit types for all fields (no `any`).
6. The plugin shall absorb the `drawio-file-io` legacy top-level fields (`openDrawioSvg`, `openDrawioPng`, `preserveCompression`) into the `drawio` namespace as part of `settingsVersion` migration (legacy → 1 移行で `drawio.openDrawioSvg` / `drawio.openDrawioPng` / `drawio.compression` (兼 `preserveCompression`) に統合する) so that all drawio settings live under a single namespace and `compression` semantics are unified.
7. The plugin shall NOT introduce additional top-level keys on `PluginSettings`; all new keys MUST live under `PluginSettings.drawio`.

### 要件 2: グローバル設定 UI (SettingsTab)

**目的:** Obsidian プラグインユーザーとして、Obsidian の設定画面から drawio の動作を GUI で変更できるようにしたい。そうすることで設定ファイルを直接編集せずに動作をカスタマイズできる。

#### 受け入れ基準

1. When the user opens Obsidian Settings, the plugin shall display a "draw.io" settings tab built with React via `ReactMountManager`.
2. The settings tab shall provide a dropdown for `theme` with options: `auto` / `light` / `dark` / `kennedy` / `min` / `atlas`.
3. The settings tab shall provide checkboxes for enabling/disabling each default shape library (general, basic, arrows3, flowchart, uml, er, bpmn, mockup, network, lean_mapping). Default libraries are shape sets bundled with the embedded drawio webapp; the plugin shall NOT fetch any library content from external URLs.
4. The settings tab shall provide an add/remove list for custom libraries that accepts only Vault-relative file paths (例: `assets/my-shapes.xml`). Inputs starting with `http://`, `https://`, `file://`, `app://` or any other scheme prefix shall be rejected at input time with an inline validation error message; only Vault-relative paths shall be persisted to `customLibraries`.
5. The settings tab shall provide a dropdown for `defaultSaveFormat` with options: `keep` (拡張子維持) / `drawio` (強制 .drawio).
6. The settings tab shall provide a toggle for `compression` (pako 圧縮).
7. The settings tab shall provide a toggle for `math` (MathJax 有効化).
8. The settings tab shall provide a dropdown for `language` with options: `auto` (Obsidian locale 追従) and supported drawio language codes (en / ja / zh / de / fr / es / pt / ru / ko / pl / nl / it).
9. The settings tab shall provide a toggle for `grid` (グリッド既定値).
10. The settings tab shall provide a toggle for `ribbonEnabled` (リボンアイコン表示).
11. When the user changes any setting, the plugin shall save the updated settings immediately via `saveSettings`.
12. When the settings tab is hidden (`hide()` lifecycle), the plugin shall unmount the React root to prevent memory leaks.
13. Where `drawio-external-sync` settings keys are added, the settings tab shall include a dedicated section for those keys marked as "外部変更の同期設定 (external-sync spec により追加)". The plugin shall not define the schema for those keys; it shall only reserve the UI section.

### 要件 3: Obsidian テーマ追従

**目的:** Obsidian プラグインユーザーとして、Obsidian のテーマ (light/dark) を切り替えたとき drawio エディタの表示もリアルタイムに追従させたい。そうすることで視覚的な一貫性が保たれる。

#### 受け入れ基準

1. When the Obsidian `css-change` event fires and `theme` setting is `auto`, the plugin shall resolve the current Obsidian theme via `getCurrentTheme()` and call `DrawioBridge.setTheme(<'light' | 'dark'>)` on all active DrawioView instances.
2. When `theme` setting is a fixed value (`light` / `dark` / `kennedy` / `min` / `atlas`), the plugin shall map the fixed value to a `DrawioBridge.setTheme()` argument as defined in 要件 3.5 at mount time and shall not react to `css-change` events.
3. When a DrawioView is mounted, the plugin shall call `DrawioBridge.setTheme()` with the resolved theme (considering `auto` → current Obsidian theme) as part of the mount sequence.
4. The plugin shall use `ThemeModule.subscribeThemeChange` (defined in `plugin-foundation`) for `css-change` subscription and shall dispose the subscription in `onunload`.
5. The plugin shall maintain a deterministic mapping from `DrawioTheme` to the `DrawioBridge.setTheme()` argument (`'light' | 'dark'`) as follows: `auto` → 現在の Obsidian テーマ (`'light'` または `'dark'`)、`light` / `kennedy` / `min` / `atlas` → `'light'`、`dark` → `'dark'`. Fine-grained drawio UI variants (`kennedy` / `min` / `atlas`) shall additionally be conveyed via `DrawioBridge.sendMessage({ action: 'configure', config: { ui: <variant> } })` at mount time, since `setTheme` alone is binary `light`/`dark` per drawio-embed-bridge contract.
6. The mapping function shall be implemented as a pure helper `resolveBridgeTheme(setting: DrawioTheme, currentObsidianTheme: 'light' | 'dark'): { setTheme: 'light' | 'dark'; uiVariant?: 'kennedy' | 'min' | 'atlas' | 'dark' }` and shall be unit-tested.

### 要件 4: 言語・locale 追従

**目的:** Obsidian プラグインユーザーとして、drawio UI の言語を Obsidian の locale と揃えたい。

#### 受け入れ基準

1. When `language` setting is `auto`, the plugin shall resolve the drawio language code from `moment.locale()` (Obsidian の locale), normalizing to the nearest drawio-supported language code or falling back to `en`.
2. When `language` is a manually specified code, the plugin shall use that code as-is when building the drawio iframe URL via `buildDrawioUrl`.
3. The plugin shall pass the resolved language code to `DrawioUrlOptions.lang` on each iframe mount.

### 要件 5: 設定マイグレーション

**目的:** Obsidian プラグイン開発者として、将来の設定スキーマ変更時にユーザーデータを自動マイグレーションできるようにしたい。

#### 受け入れ基準

1. The plugin shall define a `migrateSettings(raw: unknown): DrawioSettings` function that handles schema version differences.
2. When `settingsVersion` is `undefined` or `0` (legacy), the migration function shall assign all missing fields their default values.
3. The migration function shall never throw; if a field has an unexpected type, it shall be replaced with the default value.
4. After migration, the plugin shall save the updated settings back to storage.

---

Last revised: 2026-05-10 — per-diagram 設定機能撤去 (要件 4 / 5 削除、以降番号繰上げ)
