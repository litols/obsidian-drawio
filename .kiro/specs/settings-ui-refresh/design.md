# Technical Design — settings-ui-refresh

## Overview

**Purpose**: プラグイン設定タブを Obsidian 公式の Setting API ベースの実装へ置き換え、標準の設定行レイアウト・テーマ追従・ガイドライン準拠 (トップレベル見出しなし、インラインスタイルなし、CSS 変数使用) を実現する。

**Users**: プラグイン設定を閲覧・変更するすべてのユーザー。既存の設定項目・値・保存挙動は変わらない。

**Impact**: `src/views/SettingsTab.tsx` (React + 生 HTML) を `src/views/SettingsTab.ts` (ネイティブ Setting API) に置き換える。設定データモデル (`src/lib/settings.ts`) と i18n 文言は無変更。一覧編集のロジックは純関数として `src/lib/settings-ui.ts` へ抽出する。

### Goals
- すべての設定項目を Obsidian 標準の設定行構造で表示し、ライト/ダークテーマ双方で崩れなく描画する
- 既存の設定項目・操作 (追加・削除・リセット・重複排除・バリデーション・即時永続化) を完全維持する
- 後続 spec (drawio-preview-mode の既定表示モード、plugin-i18n の UI 言語) が 1 項目を容易に追加できる構造にする

### Non-Goals
- 設定データモデル (`PluginSettings.drawio`) の変更・項目追加
- 外部同期セクションへの操作コントロール追加
- 設定タブ以外の React 利用箇所 (DiagramSettingsModal / DiffModal 等) の変更

## Boundary Commitments

### This Spec Owns
- `DrawioSettingTab` の表示実装全体 (行構築・セクション見出し・一覧編集 UI・エラー表示)
- 一覧編集・バリデーションの純関数 (`settings-ui`) とそのテスト
- 設定画面向けの CSS クラス (styles.css 内の最小追加)

### Out of Boundary
- `src/lib/settings.ts` のデータモデル・マイグレーション (読み取り専用で利用)
- i18n 基盤と既存文言キー (利用のみ。不足キーの追加は許可)
- 他画面の React / ReactMountManager 利用

### Allowed Dependencies
- `obsidian` の `PluginSettingTab` / `Setting` / `Notice` API
- `src/lib/settings.ts` の型・定数 (`DrawioSettings`, `BASELINE_DEFAULT_LIBRARIES` 等)
- `src/lib/i18n.ts` の `t()`

### Revalidation Triggers
- `DrawioSettings` のフィールド追加・削除 (行定義の追随が必要)
- 本 spec 完了後に SettingsTab を触る spec (drawio-preview-mode / plugin-i18n) は、React 版ではなく本 spec の Setting API 構造に対して項目を追加すること

## Architecture

### Existing Architecture Analysis
- 現行 `DrawioSettingTab.display()` は空 div に React `SettingsApp` をマウントするのみ。`Setting` API は不使用で、`.setting-item` 系標準スタイルが適用されない (崩れの根本原因)
- 値の永続化は `plugin.settings.drawio` の直接書き換え + `plugin.saveSettings()` — この契約は維持する

### Architecture Pattern & Boundary Map
単一ファイルの UI 置き換えのため図は省略。パターンは「宣言的な行定義の列挙 + 標準 Setting 行の生成」:

- `display()` が `containerEl.empty()` 後、セクション順に行を構築する
- 一覧 (ライブラリ) は「既存エントリ行 (削除ボタン付き) × N + 追加入力行 + リセット」で構成し、変更時は設定を保存して `display()` を再実行する
- 値変更は従来同様 `plugin.settings.drawio` を更新して `plugin.saveSettings()` を await する

**Architecture Integration**:
- Selected pattern: Obsidian 公式の PluginSettingTab + Setting API (adopt: 公式実装に委譲)
- Existing patterns preserved: 設定の名前空間 (`PluginSettings.drawio`)、i18n `t()`、即時永続化
- New components rationale: `settings-ui` 純関数はテスト可能性のため (research.md Decision 参照)
- Steering compliance: innerHTML 不使用、外部 CDN なし、`import type` / no-any / oxlint 基準維持

### Technology Stack

| Layer | Choice / Version | Role in Feature | Notes |
|-------|------------------|-----------------|-------|
| UI | obsidian `Setting` API (既存依存) | 設定行・見出し・コントロール構築 | React は設定タブから撤去 |
| Style | styles.css + Obsidian CSS 変数 | エラー文言・一覧行の最小装飾 | インラインスタイル禁止 |
| Test | vitest (純関数) + Playwright (E2E) | 挙動維持と表示検証 | 新規依存なし |

## File Structure Plan

### New Files
```
src/lib/settings-ui.ts        # 一覧編集の純関数: validateCustomLibraryPath / addUniqueEntry (dedupe 追加)
src/lib/settings-ui.test.ts   # 上記のユニットテスト (既存 .tsx から挙動を移植して固定)
```

### Modified Files
- `src/views/SettingsTab.tsx` → **削除**し、`src/views/SettingsTab.ts` を新規作成 (export 名 `DrawioSettingTab` は不変のため `main.ts` の import は拡張子解決のみ)
- `styles.css` — `.drawio-settings-error` (color: `var(--text-error)`) 等、設定画面向け最小クラス追加
- `src/lib/i18n.ts` — 不足文言があれば追加 (既存 `settings.*` キーは流用)

> `src/lib/settings.ts` / `src/main.ts` は変更しない (import パスは `"./views/SettingsTab"` のままで解決される)。

## Requirements Traceability

| Requirement | Summary | Components | Interfaces | Flows |
|-------------|---------|------------|------------|-------|
| 1.1 | 標準の設定行構造 | DrawioSettingTab | `new Setting().setName().setDesc()` + addToggle/addDropdown/addText/addButton | — |
| 1.2 | トップレベル見出しなし | DrawioSettingTab | `<h2>` を出力しない | — |
| 1.3 | 標準セクション見出し | DrawioSettingTab | `Setting.setHeading()` | — |
| 1.4 | テーマ追従 | DrawioSettingTab, styles.css | 標準クラス + CSS 変数のみ使用 | — |
| 1.5 | i18n 経由の文言 | DrawioSettingTab | `t()` | — |
| 2.1 | 全既存項目の提供 | DrawioSettingTab | 行定義列挙 (下記) | — |
| 2.2 | 即時永続化 | DrawioSettingTab | `plugin.saveSettings()` await | — |
| 2.3 | 一覧操作の維持 | settings-ui, DrawioSettingTab | `addUniqueEntry` / reset / remove | 一覧更新 |
| 2.4 | 不正パスのエラー表示 | settings-ui, DrawioSettingTab | `validateCustomLibraryPath` + `.drawio-settings-error` | 一覧更新 |
| 2.5 | 再表示時の値復元 | DrawioSettingTab | `display()` が settings から毎回構築 | — |
| 3.1 | 隣接 spec 項目の受け入れ | DrawioSettingTab | 行定義列挙への 1 項目追加で完結する構造 | — |
| 3.2 | 外部同期セクション維持 | DrawioSettingTab | `setHeading()` + 説明行 | — |

## Components and Interfaces

| Component | Domain/Layer | Intent | Req Coverage | Key Dependencies | Contracts |
|-----------|--------------|--------|--------------|------------------|-----------|
| DrawioSettingTab | views | Setting API による設定タブ全体の構築 | 1.x, 2.x, 3.x | obsidian Setting (P0), settings-ui (P0), i18n (P1) | State |
| settings-ui | lib | 一覧編集・バリデーション純関数 | 2.3, 2.4 | なし | Service |

### views

#### DrawioSettingTab (rewrite)

| Field | Detail |
|-------|--------|
| Intent | `display()` で全設定行をネイティブ構築し、値変更を即時永続化する |
| Requirements | 1.1-1.5, 2.1-2.5, 3.1, 3.2 |

**Responsibilities & Constraints**
- 行構成 (上から順): 説明文 (editorPrefHint、`setting-item-description` 相当) → 常設ライブラリ一覧 → カスタムライブラリ一覧 → 保存形式 dropdown → 真偽値 toggle ×5 (`compression` / `math` / `ribbonEnabled` / `openDrawioSvg` / `openDrawioPng`) → drawio 表示言語 dropdown → (存在すれば) 既定表示モード dropdown → 外部同期 heading + 説明
- 一覧セクション構成: ヘッダ行 (`setName` + `setDesc` + Reset ボタン [常設のみ]) → エントリ行 ×N (`setName(id)` + 削除 ExtraButton) → 追加行 (`addText` + Add ボタン、Enter キー対応)
- 一覧変更時: `settings-ui` 純関数で次状態を計算 → `plugin.settings.drawio` 更新 → `await plugin.saveSettings()` → `this.display()` 再構築。追加入力欄は再構築後に空でフォーカス
- バリデーション失敗時: 値を追加せず、追加行直下に `.drawio-settings-error` クラスの文言を表示 (要件 2.4)
- `<h2>` / プラグイン名見出しを出力しない (要件 1.2)。インラインスタイル・innerHTML を使用しない
- `hide()` は不要になる (React unmount 撤去)。オーバーライド自体を削除

**Contracts**: State [x]

##### State Management
- State model: 表示状態は持たない。`display()` が常に `plugin.settings.drawio` から全行を再構築 (要件 2.5)
- Persistence: 変更コールバック内で即時 `saveSettings()` (要件 2.2)

**Implementation Notes**
- Integration: `main.ts` の `addSettingTab(new DrawioSettingTab(this.app, this))` は変更不要
- Validation: E2E で `.setting-item` 行の存在、`h2` 不在、toggle/dropdown 操作と保存を確認
- Risks: 再描画によるフォーカス喪失 — 追加操作直後に入力欄へ明示フォーカス (research.md Risk 参照)

### lib

#### settings-ui (純関数)

```typescript
export type LibraryPathError = "empty" | "externalUrl" | "absolute";
/** 既存 .tsx の validate ロジックを移植: 空 / URL スキーム / 絶対パスを拒否 */
export function validateCustomLibraryPath(input: string): LibraryPathError | null;
/** trim + 重複排除して追加。変更がなければ元配列をそのまま返す */
export function addUniqueEntry(list: readonly string[], entry: string): string[];
```
- Preconditions: なし (任意文字列を受理)
- Postconditions: 入力配列は破壊しない (immutable)
- 既存挙動 (`SettingsTab.tsx:120-139` の validate、`:69-72` の dedupe) と同一の判定結果を返すことをテストで固定する

## Error Handling

- 不正なライブラリパス: 追加せずインラインエラー表示 (`.drawio-settings-error`、`var(--text-error)`)。Notice は使わない (既存挙動もインライン表示)
- `saveSettings()` 失敗: console.error + `Notice` (既存の保存失敗系文言を流用)。UI 状態は直前の表示を維持

## Testing Strategy

### Unit Tests (vitest)
1. `validateCustomLibraryPath`: 空文字 / `https:` / `app:` / `//` / `/abs` / `C:\` / 正常 vault 相対パスの判定が既存実装と一致
2. `addUniqueEntry`: trim、重複時は非変更、新規追加時の順序維持

### E2E Tests (Playwright)
1. 設定タブを開くと全項目が `.setting-item` 行として表示され、`h2` 見出しが存在しない (要件 1.1, 1.2, 2.1)
2. toggle 変更 → 設定タブを閉じて再度開くと値が保持されている (要件 2.2, 2.5)
3. 常設ライブラリの追加 (Enter 含む)・削除・Reset が反映され、重複追加が無視される (要件 2.3)
4. 不正パス入力でエラー文言が表示され一覧が変化しない (要件 2.4)
5. ダークテーマ切替でレイアウト・配色が破綻しない (要件 1.4) — スクリーンショット比較は目視確認レベルで可
