# 設計ドキュメント: drawio-settings-and-config

## 概要

`drawio-settings-and-config` は、Obsidian プラグインユーザーが draw.io ダイアグラムエディタの動作をグローバルおよびファイル単位で設定できる UI・ロジック層を提供する。`plugin-foundation` の `PluginSettings` を `drawio` 名前空間で拡張し、React 製の `SettingsTab` / `DiagramSettingsModal` と、Obsidian テーマ追従・per-diagram 設定永続化の配線を実現する。

**目的**: グローバル設定 UI、テーマ追従、per-diagram 設定の永続化・編集 UI を一元提供し、後続の `drawio-external-sync` spec が設定キーを安全に追加できる拡張ポイントも確保する。  
**ユーザー**: Obsidian デスクトップユーザー (設定 UI を利用するエンドユーザー) およびプラグイン開発者 (後続 spec の実装者)。  
**影響**: `src/lib/settings.ts` を拡張し、`src/views/SettingsTab.tsx`・`src/views/DiagramSettingsModal.tsx`・`src/lib/per-diagram-config.ts`・`src/lib/theme-bridge.ts` を新設する。`src/main.ts` には `PluginSettingTab` 登録と `css-change` 購読の追加が必要。

### Goals

- `PluginSettings` の `drawio` 名前空間拡張と `settingsVersion` によるマイグレーション基盤を確立する
- Obsidian 設定画面に React 製 `SettingsTab` を表示し、全設定項目を GUI で操作できるようにする
- Obsidian テーマ変更イベントを DrawioBridge.setTheme() に接続し、リアルタイムに追従させる
- sidecar ファイル (.drawio.json) による per-diagram 設定の永続化と `DiagramSettingsModal` での編集を実現する
- `drawio-external-sync` spec が設定キーを追加できる UI 統合ポイントを確保する

### Non-Goals

- `DrawioBridge` API 自体の追加 (drawio-embed-bridge 担当)
- ファイルフォーマット reader/writer の変更 (drawio-file-io 担当)
- drawio webapp 本体の改造
- PNG / SVG メタデータの仕様策定
- クラウド連携・同期
- Mobile 対応

## バウンダリコミットメント

### This Spec Owns

- `src/lib/settings.ts` — `DrawioSettings` 型・`DEFAULT_SETTINGS` の `drawio` 名前空間フィールド・`migrateSettings` 関数
- `src/views/SettingsTab.tsx` — React 製グローバル設定 UI コンポーネント + `DrawioSettingTab` クラス (Obsidian PluginSettingTab サブクラス)
- `src/views/DiagramSettingsModal.tsx` — React 製 per-diagram 設定編集モーダル
- `src/lib/per-diagram-config.ts` — `PerDiagramConfig` 型・`loadPerDiagramConfig` / `savePerDiagramConfig` 関数
- `src/lib/theme-bridge.ts` — `subscribeThemeChange` を消費して DrawioBridge.setTheme() を呼ぶ配線ロジック
- `src/main.ts` への変更 — `PluginSettingTab` 登録、コマンド登録、テーマ購読の初期化/破棄

### Out of Boundary

- `DrawioBridge.setTheme()` の実装 (drawio-embed-bridge が定義済み)
- `DrawioBridge.setLibraries()` 等の API 追加 (必要なら drawio-embed-bridge へ差し戻し)
- `DrawioView` のライフサイクル管理 (drawio-file-io 担当)
- per-diagram 設定の差し込みポイントの実装 (drawio-file-io 担当、本 spec は API を提供するだけ)
- `drawio-external-sync` の設定スキーマ定義 (external-sync spec が行う。本 spec は UI セクションを予約するのみ)

### Allowed Dependencies

- `plugin-foundation`: `PluginSettings`、`loadSettings`/`saveSettings`、`ReactMountManager`、`ThemeModule.subscribeThemeChange`、`getCurrentTheme`
- `drawio-embed-bridge`: `DrawioBridge.setTheme()`、`DrawioBridge.mount()` オプション (`lang`、`libraries` 等)、`buildDrawioUrl` の `DrawioUrlOptions`
- `obsidian` npm パッケージ (devDependencies、型定義のみ): `PluginSettingTab`、`Modal`、`Notice`、`Plugin`、`Vault`

### Revalidation Triggers

- `PluginSettings` の型定義変更 → 本 spec の設定拡張が再検証必要
- `DrawioBridge.setTheme()` のシグネチャ変更 → `theme-bridge.ts` が再検証必要
- `ReactMountManager` の mount/unmount インターフェース変更 → SettingsTab / Modal が再検証必要
- `DrawioUrlOptions` の型変更 → per-diagram 設定マージ・URL 組み立てが再検証必要
- `drawio-external-sync` spec が `DrawioSettings` に新フィールドを追加した場合 → `migrateSettings` に新バージョン分岐を追加する必要がある
- `drawio-file-io` spec が `PluginSettings` に追加した legacy トップレベルフィールド (`openDrawioSvg` / `openDrawioPng` / `preserveCompression`) → 本 spec の `migrateSettings` がそれらを `drawio.*` 名前空間に吸収する責務を持つため、レガシーフィールドの追加・改名・削除があれば再検証必要

### 上流 spec とのスキーマ統合方針

`drawio-file-io` design.md は `PluginSettings` のトップレベルに `openDrawioSvg` / `openDrawioPng` / `preserveCompression` を追加すると記述しているが、本 spec は `drawio` 名前空間にすべての drawio 関連設定を集約する方針を採る。`migrateSettings` で legacy フィールドを `drawio.*` に吸収する (要件 1.6 / 7.x):

| Legacy トップレベル | 統合先 | 備考 |
|---|---|---|
| `openDrawioSvg: boolean` | `drawio.openDrawioSvg: boolean` | そのまま移動 |
| `openDrawioPng: boolean` | `drawio.openDrawioPng: boolean` | そのまま移動 |
| `preserveCompression: boolean` | `drawio.compression: boolean` | semantics 統合 — `compression: true` = 既定で `.drawio` 圧縮維持/書き出し |

`drawio-file-io` 実装側は本 spec が登場した時点で読み出し時に `settings.drawio.*` を参照する。`drawio-file-io` の対応漏れを防ぐため、本 spec の設計レビュー時に file-io spec への revalidation トリガを発火させる。

## アーキテクチャ

### アーキテクチャパターン & バウンダリマップ

```mermaid
graph TB
    subgraph PluginEntry
        MainTs[src/main.ts ObsidianDrawioPlugin]
    end

    subgraph SettingsLayer
        SettingsTs[src/lib/settings.ts DrawioSettings]
        SettingTab[src/views/SettingsTab.tsx DrawioSettingTab]
        MigrateTs[migrateSettings]
    end

    subgraph PerDiagramLayer
        PerDiagramTs[src/lib/per-diagram-config.ts]
        DiagramModal[src/views/DiagramSettingsModal.tsx]
    end

    subgraph ThemeBridgeLayer
        ThemeBridge[src/lib/theme-bridge.ts]
    end

    subgraph Foundation
        ReactMount[ReactMountManager]
        ThemeModule[ThemeModule subscribeThemeChange]
        SettingsBase[loadSettings saveSettings]
    end

    subgraph EmbedBridge
        DrawioBridge[DrawioBridge setTheme mount]
    end

    subgraph FileIo
        DrawioView[DrawioView per-diagram hook]
    end

    MainTs --> SettingTab
    MainTs --> ThemeBridge
    MainTs --> PerDiagramTs
    SettingTab --> SettingsTs
    SettingTab --> ReactMount
    DiagramModal --> PerDiagramTs
    DiagramModal --> ReactMount
    ThemeBridge --> ThemeModule
    ThemeBridge --> DrawioBridge
    SettingsTs --> SettingsBase
    SettingsTs --> MigrateTs
    DrawioView --> PerDiagramTs
    DrawioView --> DrawioBridge
```

**依存方向**: `Foundation` → `SettingsLayer` / `PerDiagramLayer` / `ThemeBridgeLayer` → `PluginEntry`  
`DrawioBridge` は `ThemeBridgeLayer` と `DrawioView` が consume する。本 spec は API を呼ぶだけで定義しない。

### テクノロジスタック

| 層 | ツール / バージョン | 役割 |
|---|---|---|
| Language | TypeScript 6.x (strict, no any) | 型安全な実装 |
| UI Framework | React 19 + ReactMountManager | SettingsTab / Modal の createRoot 管理 |
| Plugin API | obsidian (devDependencies) | PluginSettingTab, Modal, Notice, Vault API |
| Storage | Obsidian vault.adapter.write/read | sidecar .drawio.json の読み書き |
| Theme Detection | ThemeModule (plugin-foundation) | css-change 購読・getCurrentTheme() |
| Bridge | DrawioBridge (drawio-embed-bridge) | setTheme() 呼び出し |

## ファイル構成

### ディレクトリ構造

```
src/
├── main.ts                          # PluginSettingTab 登録・コマンド登録・テーマ購読追加 (変更)
├── lib/
│   ├── settings.ts                  # DrawioSettings 型・DEFAULT_SETTINGS 拡張・migrateSettings (変更)
│   ├── per-diagram-config.ts        # PerDiagramConfig 型・load/save 関数 (新規)
│   └── theme-bridge.ts              # css-change → DrawioBridge.setTheme 配線 (新規)
└── views/
    ├── SettingsTab.tsx              # DrawioSettingTab (PluginSettingTab サブクラス) + React UI (新規)
    └── DiagramSettingsModal.tsx     # DiagramSettingsModal (Modal サブクラス) + React UI (新規)
```

### 変更ファイル

- `src/main.ts` — `onload()` に `DrawioSettingTab` 追加 (`this.addSettingTab`)、"drawio: 図の設定を編集" コマンド追加、`ThemeBridge` 初期化・`onunload()` に dispose 追加
- `src/lib/settings.ts` — `PluginSettings` に `drawio: DrawioSettings` フィールドを追加、`DEFAULT_SETTINGS` 更新、`migrateSettings` 追加

## システムフロー

### SettingsTab 表示フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant Obsidian as Obsidian Settings
    participant SettingTab as DrawioSettingTab
    participant React as React Root

    User->>Obsidian: 設定画面を開く
    Obsidian->>SettingTab: display(containerEl)
    SettingTab->>React: mountManager.mount(containerEl, SettingsApp)
    React-->>User: 設定 UI 表示

    User->>React: 設定値変更
    React->>SettingTab: onSettingsChange(newSettings)
    SettingTab->>Obsidian: saveSettings(plugin, settings)

    User->>Obsidian: 設定画面を閉じる
    Obsidian->>SettingTab: hide()
    SettingTab->>React: mountManager.unmount(containerEl)
```

### テーマ追従フロー

```mermaid
sequenceDiagram
    participant Obsidian as Obsidian Workspace
    participant ThemeModule as ThemeModule (foundation)
    participant ThemeBridge as ThemeBridge
    participant Resolver as resolveBridgeTheme()
    participant Bridge as DrawioBridge

    Obsidian->>ThemeModule: css-change event
    ThemeModule->>ThemeBridge: callback(currentTheme)
    ThemeBridge->>ThemeBridge: settings.drawio.theme === 'auto' ?
    alt auto モード
        ThemeBridge->>Resolver: resolveBridgeTheme('auto', currentTheme)
        Resolver-->>ThemeBridge: { setTheme: 'light' | 'dark' }
        ThemeBridge->>Bridge: setTheme('light' | 'dark') for each registered bridge
    else 固定モード
        ThemeBridge->>ThemeBridge: 何もしない (css-change 無視)
    end
```

### Mount 時テーマ初期化フロー

```mermaid
sequenceDiagram
    participant View as DrawioView mount
    participant ThemeBridge as ThemeBridge
    participant Resolver as resolveBridgeTheme()
    participant Bridge as DrawioBridge

    View->>ThemeBridge: applyTheme(bridge)
    ThemeBridge->>Resolver: resolveBridgeTheme(settings.drawio.theme, getCurrentTheme())
    Resolver-->>ThemeBridge: { setTheme, uiVariant? }
    ThemeBridge->>Bridge: setTheme(setTheme)
    opt uiVariant 指定あり (kennedy / min / atlas / dark)
        ThemeBridge->>Bridge: sendMessage({ action: 'configure', config: { ui: uiVariant } })
    end
```

### DrawioTheme → DrawioBridge マッピング表

| `DrawioSettings.theme` | `setTheme` 引数 | `configure.ui` 追加送信 | 備考 |
|---|---|---|---|
| `auto` | `getCurrentTheme()` (`'light'` または `'dark'`) | なし | css-change 購読 |
| `light` | `'light'` | なし | デフォルトの drawio UI (kennedy 相当) |
| `dark` | `'dark'` | なし | drawio dark UI |
| `kennedy` | `'light'` | `'kennedy'` | 明示的に kennedy variant |
| `min` | `'light'` | `'min'` | minimal UI |
| `atlas` | `'light'` | `'atlas'` | atlas UI |

### per-diagram 設定保存フロー

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant Command as Obsidian Command
    participant Modal as DiagramSettingsModal
    participant PerDiagram as per-diagram-config
    participant Vault as Obsidian Vault

    User->>Command: "drawio: 図の設定を編集" 実行
    Command->>Modal: open(currentFilePath)
    Modal->>PerDiagram: loadPerDiagramConfig(vault, filePath)
    PerDiagram->>Vault: vault.adapter.read('<file>.drawio.json')
    Vault-->>PerDiagram: JSON or not found
    PerDiagram-->>Modal: PerDiagramConfig (or empty)
    Modal-->>User: 設定 UI 表示

    User->>Modal: 設定変更 + 確認
    Modal->>PerDiagram: savePerDiagramConfig(vault, filePath, config)
    PerDiagram->>Vault: vault.adapter.write('<file>.drawio.json', JSON)
    Modal->>Modal: close() + unmount React
```

## 要件トレーサビリティ

| 要件 | 概要 | コンポーネント | インターフェース |
|------|------|--------------|----------------|
| 1.1-1.5 | グローバル設定スキーマ | SettingsModule | DrawioSettings, DEFAULT_SETTINGS |
| 2.1-2.13 | SettingsTab UI | DrawioSettingTab, SettingsApp | PluginSettingTab |
| 3.1-3.4 | テーマ追従 | ThemeBridge | subscribeThemeChange, setTheme |
| 4.1-4.6 | per-diagram 永続化 | PerDiagramConfig | loadPerDiagramConfig, savePerDiagramConfig |
| 5.1-5.5 | DiagramSettingsModal | DiagramSettingsModal | Modal, ReactMountManager |
| 6.1-6.3 | 言語・locale 追従 | SettingsModule, DrawioView | DrawioUrlOptions.lang |
| 7.1-7.4 | 設定マイグレーション | SettingsModule | migrateSettings |

## コンポーネントとインターフェース

### コンポーネントサマリー

| コンポーネント | 層 | 役割 | 要件カバレッジ | 主要依存 (P0/P1) | Contracts |
|---|---|---|---|---|---|
| SettingsModule | Lib | 設定型定義・拡張・マイグレーション | 1, 7 | plugin-foundation PluginSettings (P0) | State |
| DrawioSettingTab | Views | Obsidian PluginSettingTab + React マウント管理 | 2 | ReactMountManager (P0), SettingsModule (P0) | Service |
| PerDiagramConfigModule | Lib | per-diagram 設定の型定義・load/save | 4 | Obsidian Vault API (P0) | Service, State |
| DiagramSettingsModal | Views | per-diagram 設定編集モーダル | 5 | ReactMountManager (P0), PerDiagramConfigModule (P0) | Service |
| ThemeBridge | Lib | css-change → DrawioBridge.setTheme 配線 | 3 | ThemeModule (P0), DrawioBridge (P0) | Event |
| LibraryBridge | Lib | customLibraries (Vault 相対パス) を読み込み `DrawioBridge.setLibraries` 用の `{ title, entries }` 配列に変換して bridge へ適用 | 2.3, 2.4 | Obsidian Vault API (P0), DrawioBridge (P0), SettingsModule (P0) | Service |

---

### Lib 層

#### SettingsModule

| フィールド | 詳細 |
|---|---|
| Intent | `PluginSettings` の `drawio` 名前空間を定義し、DEFAULT_SETTINGS と migrateSettings を提供する |
| 要件 | 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 7.3, 7.4 |

**責務と制約**

- `DrawioSettings` interface を定義し、後続 spec (external-sync) が `DrawioSettings` に型安全にフィールドを追加できるよう `Partial` 拡張可能な設計にする
- `PluginSettings` を `{ drawio: DrawioSettings; [key: string]: unknown }` として拡張する (既存契約を破壊しない)
- `migrateSettings` は `unknown` を受け取り常に `DrawioSettings` を返す; throw しない

**依存関係**

- Inbound: `ObsidianDrawioPlugin.onload()` — loadSettings 呼び出し (P0)
- Outbound: `plugin-foundation` SettingsModule — `loadSettings` / `saveSettings` (P0)

**Contracts**: Service [ ] / API [ ] / Event [ ] / Batch [ ] / State [x]

##### State Management

```typescript
// src/lib/settings.ts への追加

export type DrawioTheme = 'auto' | 'light' | 'dark' | 'kennedy' | 'min' | 'atlas';
export type DrawioLanguage = 'auto' | 'en' | 'ja' | 'zh' | 'de' | 'fr' | 'es' | 'pt' | 'ru' | 'ko' | 'pl' | 'nl' | 'it';
export type DrawioSaveFormat = 'keep' | 'drawio';

export interface DrawioSettings {
  settingsVersion: number;
  theme: DrawioTheme;
  defaultLibraries: string[];
  customLibraries: string[];
  defaultSaveFormat: DrawioSaveFormat;
  compression: boolean;        // 兼 preserveCompression (drawio-file-io legacy 互換)
  math: boolean;
  language: DrawioLanguage;
  grid: boolean;
  ribbonEnabled: boolean;
  openDrawioSvg: boolean;      // drawio-file-io から吸収
  openDrawioPng: boolean;      // drawio-file-io から吸収
}

export const DEFAULT_DRAWIO_SETTINGS: DrawioSettings = {
  settingsVersion: 1,
  theme: 'auto',
  defaultLibraries: ['general'],
  customLibraries: [],
  defaultSaveFormat: 'keep',
  compression: true,           // drawio 既定の圧縮維持を踏襲 (file-io の preserveCompression: true と一致)
  math: false,
  language: 'auto',
  grid: true,
  ribbonEnabled: true,
  openDrawioSvg: true,
  openDrawioPng: true,
};

export function migrateSettings(raw: unknown): DrawioSettings;
// raw が object でない場合は DEFAULT_DRAWIO_SETTINGS を返す
// 各フィールドが期待する型でなければ DEFAULT から補完する
// settingsVersion を最新に更新して返す

// PluginSettings を拡張
// plugin-foundation の PluginSettings に drawio フィールドを追加
// (plugin-foundation spec の PluginSettings に [key: string]: unknown があるため型安全に拡張可能)
export interface DrawioPluginSettings {
  drawio: DrawioSettings;
}
```

##### external-sync 統合パターン

`drawio-external-sync` spec は `DrawioSettings` を **intersection type** で拡張する。本 spec は型を `interface` (open) で公開し、external-sync 側は declaration merging または専用 interface を経由して拡張する:

```typescript
// drawio-external-sync 側で:
declare module './settings.ts' {
  interface DrawioSettings {
    externalSync?: {
      autoReloadWhenClean: boolean;
      notificationLevel: 'none' | 'notice' | 'status-bar';
    };
  }
}
```

`migrateSettings` は `settingsVersion` 分岐により、external-sync が追加した時点で `version 2` への移行ロジックを external-sync spec が追加する責務を持つ。本 spec は `version 1` までを定義する。

##### resolveBridgeTheme helper

```typescript
// src/lib/settings.ts または src/lib/theme-bridge.ts に同居

export interface ResolvedBridgeTheme {
  setTheme: 'light' | 'dark';
  uiVariant?: 'kennedy' | 'min' | 'atlas' | 'dark';
}

export function resolveBridgeTheme(
  setting: DrawioTheme,
  currentObsidianTheme: 'light' | 'dark',
): ResolvedBridgeTheme;
// マッピング表 (design.md 内) に従って純粋関数として実装。
// uiVariant は設定値が kennedy / min / atlas / dark のときのみ非 undefined。
```

---

#### PerDiagramConfigModule

| フィールド | 詳細 |
|---|---|
| Intent | per-diagram 設定の型定義と sidecar ファイルへの load/save を提供する |
| 要件 | 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 |

**責務と制約**

- sidecar パスは `<filePath>.json` (例: `diagrams/flow.drawio` → `diagrams/flow.drawio.json`)
- `vault.adapter.read` / `vault.adapter.write` のみ使用 (Vault API)
- JSON パースエラー時は空の `PerDiagramConfig` を返し throw しない

**依存関係**

- Inbound: `DiagramSettingsModal` — save 呼び出し (P0)
- Inbound: `DrawioView` (drawio-file-io) — load 呼び出し (P1)
- External: Obsidian `Vault` / `vault.adapter` — ファイル読み書き (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [x]

##### Service Interface

```typescript
// src/lib/per-diagram-config.ts

import type { Vault } from 'obsidian';
import type { DrawioTheme } from './settings.ts';

export interface PerDiagramConfig {
  libraries?: string[];
  theme?: DrawioTheme;
  math?: boolean;
  grid?: boolean;
}

export function sidecarPath(filePath: string): string;
// 例: 'diagrams/flow.drawio' → 'diagrams/flow.drawio.json'

export async function loadPerDiagramConfig(
  vault: Vault,
  filePath: string,
): Promise<PerDiagramConfig>;
// sidecar が存在しない場合 {} を返す
// JSON パースエラー時も {} を返す (console.warn)

export async function savePerDiagramConfig(
  vault: Vault,
  filePath: string,
  config: PerDiagramConfig,
): Promise<void>;
// vault.adapter.write でアトミック書き込み
// config が空オブジェクトの場合はファイルを削除する

export function registerPerDiagramConfigLifecycle(plugin: Plugin): void;
// vault.on('rename', (file, oldPath) => sidecar の rename を追従)
// vault.on('delete', file => 対応する sidecar も削除)
// 監視対象拡張子: '.drawio' / '.drawio.svg' / '.drawio.png'
// 失敗時は console.error + Notice 表示、throw しない
// plugin.registerEvent でラップして onunload 時に自動解除する
```

##### Sidecar Lifecycle 不変条件

- `.drawio` ファイル `foo/bar.drawio` の sidecar は `foo/bar.drawio.json`
- リネーム/移動: 元 sidecar が存在する場合のみ rename を試みる (存在しない場合は no-op)
- 削除: 元 sidecar が存在する場合のみ削除を試みる (存在しない場合は no-op)
- ファイル形式判定 (drawio-file-io 側 `readDrawioFile`): `.json` 拡張子は drawio フォーマット判定対象外として除外する
- `DrawioView` の `registerExtensions` は `.drawio` のみを登録するため、`.drawio.json` は通常の Obsidian view (JSON view 等) で開かれる

- Preconditions: `filePath` は Vault 内の有効なパス
- Postconditions: `savePerDiagramConfig` 後に `loadPerDiagramConfig` を呼ぶと同一設定が返る
- Invariants: load は throw しない; save は I/O エラーを caller に伝播する

---

#### ThemeBridge

| フィールド | 詳細 |
|---|---|
| Intent | css-change イベントを DrawioBridge.setTheme() に接続する配線ロジック |
| 要件 | 3.1, 3.2, 3.3, 3.4 |

**責務と制約**

- `settings.drawio.theme === 'auto'` のときのみ `css-change` に反応する
- 固定テーマのときは subscribe 不要だが、mount 時の初回 setTheme() は呼ぶ
- View の登録/解除 API を持ち、アクティブな DrawioBridge の集合を管理する

**依存関係**

- Inbound: `ObsidianDrawioPlugin.onload()` — 初期化 (P0)
- Outbound: `ThemeModule.subscribeThemeChange` (plugin-foundation) — css-change 購読 (P0)
- Outbound: `DrawioBridge.setTheme()` (drawio-embed-bridge) — テーマ更新 (P0)

**Contracts**: Service [x] / API [ ] / Event [x] / Batch [ ] / State [x]

##### Service Interface

```typescript
// src/lib/theme-bridge.ts

import type { Plugin } from 'obsidian';
import type { DrawioBridge } from './drawio-bridge.ts';
import type { DrawioSettings } from './settings.ts';

export interface ThemeBridge {
  registerBridge(bridge: DrawioBridge): void;
  unregisterBridge(bridge: DrawioBridge): void;
  applyTheme(bridge: DrawioBridge): void;
  dispose(): void;
}

export function createThemeBridge(
  plugin: Plugin,
  getSettings: () => DrawioSettings,
): ThemeBridge;
// subscribeThemeChange で css-change を購読
// theme === 'auto' のとき変更時に全登録 bridge に setTheme を呼ぶ
```

##### Event Contract

- 購読イベント: `workspace.on('css-change')` (ThemeModule 経由)
- theme が `auto` 以外の場合は css-change に反応しない
- `dispose()` で EventRef を解除する

##### State Management

- State model: `Set<DrawioBridge>` で登録済み bridge を管理
- Persistence: メモリのみ (Plugin インスタンスのライフタイム)

---

### Views 層

#### DrawioSettingTab

| フィールド | 詳細 |
|---|---|
| Intent | Obsidian PluginSettingTab サブクラスとして React 製設定 UI をマウント/アンマウントする |
| 要件 | 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13 |

**責務と制約**

- `display(containerEl)` → `mountManager.mount(containerEl, <SettingsApp .../>)`
- `hide()` → `mountManager.unmount(containerEl)` (memory leak 防止)
- `SettingsApp` は React コンポーネント; Obsidian CSS variables を使用し `dangerouslySetInnerHTML` 禁止

**依存関係**

- Inbound: Obsidian runtime (display/hide ライフサイクル) (P0)
- Outbound: `ReactMountManager` (plugin-foundation) — createRoot/unmount (P0)
- Outbound: `SettingsModule` — DrawioSettings 読み書き (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface

```typescript
// src/views/SettingsTab.tsx

import { PluginSettingTab, type App } from 'obsidian';
import type { ObsidianDrawioPlugin } from '../main.ts';

export class DrawioSettingTab extends PluginSettingTab {
  constructor(app: App, plugin: ObsidianDrawioPlugin);
  display(): void;
  hide(): void;
}
```

**実装ノート**

- Integration: `plugin.addSettingTab(new DrawioSettingTab(app, plugin))` を `onload()` で呼ぶ
- external-sync 設定セクションは `<section data-spec="external-sync">` で予約し、実際の設定コンポーネントは external-sync spec が実装する
- Risks: React 更新が Obsidian のテーマ変更と競合しないよう、`onSettingsChange` で保存後に re-render をトリガーすること

---

#### DiagramSettingsModal

| フィールド | 詳細 |
|---|---|
| Intent | per-diagram 設定を編集する React 製モーダル。Obsidian Modal サブクラス |
| 要件 | 5.1, 5.2, 5.3, 5.4, 5.5 |

**責務と制約**

- Obsidian の `Modal` を継承し `onOpen()` で React マウント、`onClose()` で unmount
- 「グローバル設定を使用」を示す indeterminate 状態を `undefined` フィールドで表現する

**依存関係**

- Inbound: Obsidian command (P0)
- Outbound: `ReactMountManager` — createRoot/unmount (P0)
- Outbound: `PerDiagramConfigModule` — load/save (P0)

**Contracts**: Service [x] / API [ ] / Event [ ] / Batch [ ] / State [ ]

##### Service Interface

```typescript
// src/views/DiagramSettingsModal.tsx

import { Modal, type App } from 'obsidian';
import type { Vault } from 'obsidian';

export class DiagramSettingsModal extends Modal {
  constructor(app: App, vault: Vault, filePath: string, onSave: () => void);
  onOpen(): void;
  onClose(): void;
}
```

**実装ノート**

- Integration: コマンドから `new DiagramSettingsModal(app, vault, activeFilePath, reloadView).open()` で起動
- Validation: `filePath` が空のときコンストラクタで `Notice` を出して `close()` する
- Risks: `onClose()` は ESC キーや背景クリックでも発火するため unmount を必ず実行すること

## データモデル

### ドメインモデル

```
DrawioPluginSettings (Obsidian data.json に永続化)
  └── drawio: DrawioSettings
        ├── settingsVersion: number
        ├── theme: DrawioTheme
        ├── defaultLibraries: string[]
        ├── customLibraries: string[]
        ├── defaultSaveFormat: DrawioSaveFormat
        ├── compression: boolean
        ├── math: boolean
        ├── language: DrawioLanguage
        ├── grid: boolean
        └── ribbonEnabled: boolean

PerDiagramConfig (sidecar <file>.drawio.json に永続化)
  ├── libraries?: string[]     // 上書きしない場合は undefined
  ├── theme?: DrawioTheme      // 上書きしない場合は undefined
  ├── math?: boolean           // 上書きしない場合は undefined
  └── grid?: boolean           // 上書きしない場合は undefined
```

### 設定マージ優先順位

```
per-diagram config (最高優先) > global DrawioSettings > DEFAULT_DRAWIO_SETTINGS
```

`PerDiagramConfig` のフィールドが `undefined` の場合は `DrawioSettings` の値を使用する。

### settingsVersion マイグレーション表

| version | 内容 |
|---------|------|
| 0 / undefined | 旧バージョン。全フィールドを DEFAULT で補完 |
| 1 | 現行スキーマ (本 spec が確立) |
| 2+ | 将来の external-sync spec 等が追加した場合 |

## エラーハンドリング

### エラー戦略

- `loadPerDiagramConfig` — sidecar 不存在 or JSON パースエラー → `{}` を返し `console.warn`
- `savePerDiagramConfig` — I/O エラー → caller に伝播 (`console.error` + Obsidian `Notice` で通知)
- `migrateSettings` — 型不一致フィールド → DEFAULT 値で補完、throw しない
- React mount/unmount エラー → `console.error` でログし他の root に影響しない

### エラーカテゴリ

- **System Error**: Vault I/O 失敗 → Notice 表示 + console.error
- **Data Error**: JSON スキーマ不一致 → DEFAULT 補完 (graceful degradation)
- **Runtime Error**: React mount 失敗 → console.error のみ

## テスト戦略

### 単体テスト

- `migrateSettings(null)` → `DEFAULT_DRAWIO_SETTINGS` を返すこと
- `migrateSettings({ settingsVersion: 0 })` → 全フィールドが DEFAULT で補完されること
- `sidecarPath('diagrams/flow.drawio')` → `'diagrams/flow.drawio.json'` を返すこと
- `loadPerDiagramConfig` — sidecar 不存在時に `{}` を返すこと
- `loadPerDiagramConfig` — JSON パースエラー時に `{}` を返し throw しないこと

### 統合テスト

- `savePerDiagramConfig` → `loadPerDiagramConfig` で同一データが取得できること
- `DrawioSettingTab.display()` + `hide()` で React root が正しくマウント/アンマウントされること
- テーマ設定 `auto` のとき css-change イベントで `DrawioBridge.setTheme` が呼ばれること
- テーマ設定 `dark` のとき css-change イベントが無視されること

### 手動検証 (Obsidian Desktop)

- 設定画面を開き全設定項目が表示・変更・保存できること
- 設定画面を閉じて再度開いたとき変更が保持されていること
- Obsidian テーマ切り替え時に draw.io iframe のテーマが追従すること
- "drawio: 図の設定を編集" コマンドでモーダルが開き、設定変更後に図が再読み込みされること

## セキュリティ考慮事項

- `dangerouslySetInnerHTML` 使用禁止 (Obsidian 審査要件)
- カスタムライブラリパスは Vault 相対パスのみ受け付ける (外部 URL 禁止)
- sidecar JSON のパースは `JSON.parse` を使用し、スキーマ検証で予期しない型を排除する

## マイグレーション戦略

- `settingsVersion` フィールドでスキーマバージョンを識別する
- 将来 external-sync spec が `DrawioSettings` に新フィールドを追加する場合、`migrateSettings` にバージョン分岐を追加し DEFAULT で補完する
- ロールバック: `data.json` を削除すると `DEFAULT_DRAWIO_SETTINGS` で初期化される (データは失われるが安全)
