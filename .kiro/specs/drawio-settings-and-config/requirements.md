# 要件定義書: drawio-settings-and-config

## はじめに

Obsidian で draw.io ダイアグラムを編集するユーザーは、テーマ・shape library・保存形式・言語などの動作を GUI から設定する手段を持っていない。また、特定のファイルだけ異なる iconset を使うといった図ファイルごとの上書き設定を保存する仕組みもない。

本機能は以下を実現する:
- `PluginSettingTab` (React) によるグローバル設定 UI
- Obsidian テーマ追従 (`css-change` イベント → `DrawioBridge.setTheme()`)
- 図ファイルごとの設定 (per-diagram config) の永続化と編集 UI
- 設定スキーマのバージョン管理 (`settingsVersion`)
- `drawio-external-sync` spec が追加する設定キーの統合ポイント (UI のみ担当、スキーマ定義は external-sync spec が行う)

## バウンダリコンテキスト

- **対象**: `PluginSettings` の拡張、グローバル設定 UI、per-diagram 設定の永続化・編集 UI、テーマ追従の配線
- **対象外**: `DrawioBridge` API 自体の追加 (drawio-embed-bridge 担当)、ファイルフォーマット reader/writer (drawio-file-io 担当)、drawio webapp 本体の改造
- **隣接期待**: drawio-file-io が `DrawioView` に per-diagram 設定の差し込みポイントを用意すること。drawio-embed-bridge が `setTheme` / `setLibraries` / `sendMessage` API を提供すること

## 要件

### 要件 1: グローバル設定スキーマ

**目的:** Obsidian プラグインユーザーとして、テーマ・shape library・保存形式など drawio の動作設定を型安全かつバージョン管理された形式で永続化できるようにしたい。そうすることで Obsidian の再起動やバージョンアップ後も設定が保持される。

#### 受け入れ基準

1. The plugin shall extend `PluginSettings` (defined in `plugin-foundation`) with a `drawio` namespace field containing all drawio-specific settings, without breaking the existing `PluginSettings` contract.
2. The plugin shall include a `settingsVersion` number field in the `drawio` namespace to identify the schema version for future migration.
3. When `settingsVersion` is absent or lower than the current version in stored data, the plugin shall migrate settings to the current schema using a migration function and save the updated data.
4. The plugin shall provide `DEFAULT_SETTINGS` values for all new fields: `theme: 'auto'`, `defaultLibraries: ['general']`, `customLibraries: []`, `defaultSaveFormat: 'keep'`, `compression: false`, `math: false`, `language: 'auto'`, `grid: true`, `ribbonEnabled: true`.
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

### 要件 4: per-diagram 設定の永続化

**目的:** Obsidian プラグインユーザーとして、特定の図ファイルに対して異なる iconset や設定上書きを保存し、次回開いたときに復元されるようにしたい。

#### 受け入れ基準

1. The plugin shall persist per-diagram configuration as a sidecar file `<filename>.drawio.json` in the same Vault directory as the `.drawio` file (案 B: sidecar approach).
2. When a DrawioView opens a file, the plugin shall load the corresponding sidecar file (if it exists) and merge per-diagram settings with global settings, with per-diagram settings taking precedence.
3. When per-diagram settings are saved, the plugin shall write the sidecar file atomically via Obsidian Vault API (`vault.adapter.write`).
4. If the sidecar file does not exist, the plugin shall treat per-diagram settings as empty (global settings apply).
5. The plugin shall define a `PerDiagramConfig` TypeScript interface with fields: `libraries?: string[]` (overrides default libraries for this diagram), `theme?: DrawioTheme` (per-diagram theme override), `math?: boolean`, `grid?: boolean`.
6. The plugin shall export a `loadPerDiagramConfig(vault, filePath)` function and a `savePerDiagramConfig(vault, filePath, config)` function.
7. When the source `.drawio` / `.drawio.svg` / `.drawio.png` file is renamed or moved within the Vault, the plugin shall rename/move the associated sidecar `<filename>.json` to follow the new path. Implementation: subscribe to `vault.on('rename', (file, oldPath) => ...)` and call `vault.adapter.rename(sidecarPath(oldPath), sidecarPath(file.path))` when the old sidecar exists. Failures shall be logged and surfaced via `Notice` but shall not throw.
8. When the source file is deleted from the Vault, the plugin shall delete the associated sidecar file via `vault.on('delete', ...)`. Failures shall be logged but shall not throw.
9. The plugin shall NOT create a sidecar file when the merged `PerDiagramConfig` is empty; an empty save shall instead delete the existing sidecar (per 要件 4.3 補足: `savePerDiagramConfig` の実装責務).
10. Sidecar files shall be excluded from drawio file format detection (i.e. `.drawio.json` MUST NOT be opened by `DrawioView` or treated as a drawio diagram).

### 要件 5: per-diagram 設定編集 UI (DiagramSettingsModal)

**目的:** Obsidian プラグインユーザーとして、開いている図ファイルの per-diagram 設定をモーダルから変更したい。そうすることで drawio webapp のメニューを変更せずに設定を上書きできる。

#### 受け入れ基準

1. The plugin shall register an Obsidian command "drawio: 図の設定を編集" that opens a `DiagramSettingsModal` for the currently active DrawioView.
2. The `DiagramSettingsModal` shall be built with React via `ReactMountManager` and shall display fields for: libraries override (checkbox list), theme override (dropdown with blank/empty option meaning "use global"), math override (toggle with indeterminate/blank state meaning "use global"), grid override (toggle with indeterminate/blank state meaning "use global").
3. When the user confirms the modal, the plugin shall save the per-diagram config via `savePerDiagramConfig` and reload the DrawioView with the updated merged settings.
4. When the `DiagramSettingsModal` is closed, the plugin shall unmount the React root.
5. If no DrawioView is currently active, the command shall show an Obsidian `Notice` "draw.io ファイルを開いた状態で実行してください".

### 要件 6: 言語・locale 追従

**目的:** Obsidian プラグインユーザーとして、drawio UI の言語を Obsidian の locale と揃えたい。

#### 受け入れ基準

1. When `language` setting is `auto`, the plugin shall resolve the drawio language code from `moment.locale()` (Obsidian の locale), normalizing to the nearest drawio-supported language code or falling back to `en`.
2. When `language` is a manually specified code, the plugin shall use that code as-is when building the drawio iframe URL via `buildDrawioUrl`.
3. The plugin shall pass the resolved language code to `DrawioUrlOptions.lang` on each iframe mount.

### 要件 7: 設定マイグレーション

**目的:** Obsidian プラグイン開発者として、将来の設定スキーマ変更時にユーザーデータを自動マイグレーションできるようにしたい。

#### 受け入れ基準

1. The plugin shall define a `migrateSettings(raw: unknown): DrawioSettings` function that handles schema version differences.
2. When `settingsVersion` is `undefined` or `0` (legacy), the migration function shall assign all missing fields their default values.
3. The migration function shall never throw; if a field has an unexpected type, it shall be replaced with the default value.
4. After migration, the plugin shall save the updated settings back to storage.
