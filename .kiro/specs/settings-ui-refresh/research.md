# Research & Design Decisions — settings-ui-refresh

## Summary
- **Feature**: `settings-ui-refresh`
- **Discovery Scope**: Simple Addition (既存設定タブの UI 層置き換え)
- **Key Findings**:
  - レイアウト崩れの根本原因は、Obsidian の `Setting` API を使わず React + 生 HTML + インラインスタイルで描画しているため、`.setting-item` 系の標準スタイルが一切適用されないこと (`src/views/SettingsTab.tsx:180-240`、`new Setting(` はソース全体で 0 件)
  - `styles.css` に設定画面向けルールは皆無。`.drawio-settings-app` は未スタイル
  - 既存 i18n キー (`settings.*`) は en/ja 定義済みで標準 UI へそのまま流用可能

## Research Log

### 現行実装と公式ガイドラインの差分
- **Context**: 「設定が崩れている」の原因特定 (調査エージェント explore-settings のレポートに基づく)
- **Sources Consulted**: `src/views/SettingsTab.tsx`, `styles.css`, https://docs.obsidian.md/Plugins/User+interface/Settings, https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- **Findings**:
  - 公式作法: `new Setting(containerEl).setName().setDesc().addToggle/addDropdown/addText/addButton()`。見出しは `setHeading()`。`display()` 冒頭で `containerEl.empty()`
  - ガイドライン: トップレベル見出し (プラグイン名 / General / Settings) 禁止、インラインスタイル禁止 (CSS クラス化)、CSS 変数使用、`innerHTML` 禁止、Sentence case
  - 現行の逸脱: `<h2>draw.io</h2>` (`:182`)、インラインスタイル多用 (`:80,:96,:101,:184`)、`color:"red"` ハードコード (`:101,:155`)、input/select に幅・クラスなし
  - external-sync セクションは見出し + 説明のみでコントロールなし (`:234-238`) — コントロール追加は本 spec のスコープ外として維持
- **Implications**: UI 層の全面置き換えが必要。データモデル (`settings.ts`) と i18n は無変更で流用

### spec 間の調整事項
- **Context**: 同じファイルを触る並行・後続 spec の存在
- **Findings**:
  - `drawio-preview-mode` (並行) が `defaultOpenMode` ドロップダウンを追加する
  - `plugin-i18n` (未着手 0/21) が UI Language ドロップダウンを追加予定。roadmap 上「SettingsTab 改変は settings-and-config 完了後」の順序制約あり
  - steering の共有シーム: 設定は `PluginSettings.drawio` 名前空間限定、`PluginSettings` の破壊変更禁止
- **Implications**: 設定行の構築を「項目定義を列挙して標準行を生成する」形に整理し、後続 spec が 1 項目追加しやすい構造にする。データモデルには触れない

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: ネイティブ Setting API へ置換 (採用) | React をやめ `display()` 内で `new Setting()` を直接構築 | ガイドライン完全準拠、標準スタイル自動適用、テーマ/将来の Obsidian 変更に自動追従、依存削減 | 一覧編集 UI (ライブラリ) は行生成ロジックを自前で書く | explore-settings の推奨とも一致 |
| B: React 維持 + `.setting-item` 構造の自前再現 | React コンポーネントで標準クラスを模倣 | 既存コード温存 | Obsidian 内部クラス構造への依存 (非公開契約)、模倣漏れで再び崩れる | 却下 |

## Design Decisions

### Decision: React 実装を廃止しネイティブ Setting API で再構築する
- **Context**: 要件 1.1-1.4 (標準行構造・テーマ追従)
- **Alternatives Considered**: 上表 A / B
- **Selected Approach**: `DrawioSettingTab.display()` が `new Setting()` で全行を構築。React マウントは設定タブから撤去 (他画面の React 利用は不変)
- **Rationale**: `.setting-item` の構造とスタイルは Obsidian が所有する非公開実装であり、模倣 (B) は将来壊れる。公式 API に載せるのが唯一の安定解
- **Trade-offs**: ライブラリ一覧の追加/削除 UI は再描画制御 (`display()` 再呼び出し) を自前で行う
- **Follow-up**: 一覧更新時の再描画で入力フォーカスが失われないよう、追加入力行の状態保持を実装時に確認

### Decision: 一覧編集ロジックを純関数へ抽出する
- **Context**: 要件 2.3, 2.4 (追加・削除・リセット・重複排除・バリデーションの完全維持)。Setting API の DOM は jsdom 単体テストに不向き
- **Selected Approach**: バリデーション (`validateCustomLibraryPath`) と一覧操作 (追加時 dedupe 等) を `src/lib/settings-ui.ts` の純関数に抽出し、既存 `.tsx` 内のロジックを移植。ユニットテストは純関数に対して行い、DOM 組み立ては薄く保つ
- **Rationale**: 挙動維持の検証をテストで担保しつつ、UI 層はガイドライン準拠の宣言的構築に専念させる
- **Trade-offs**: ファイルが 1 つ増える

### Decision: エラー表示・補助テキストは CSS クラス + テーマ変数で行う
- **Context**: 要件 1.4, 2.4。ガイドラインのインラインスタイル禁止・CSS 変数使用
- **Selected Approach**: `styles.css` に `.drawio-settings-error { color: var(--text-error); }` 等の最小クラスを追加。補助説明は `setting-item-description` 相当の標準クラス / `setDesc` を使用
- **Rationale**: ユーザーがテーマ/スニペットで上書き可能になる

## Risks & Mitigations
- **一覧再描画によるフォーカス喪失・入力値消失** — 追加操作後は入力欄を明示的にクリアして再フォーカス。E2E で連続追加操作を検証
- **並行 spec (drawio-preview-mode) との SettingsTab 競合** — 実装順序を調整 (本 spec を先に実装し、preview 側は完成後の構造に 1 行追加)。コンフリクト時は本 spec の構造が正
- **plugin-i18n の後続改変** — 項目追加が 1 箇所で済む列挙構造を保つ

## References
- [Obsidian Settings docs](https://docs.obsidian.md/Plugins/User+interface/Settings) — Setting API の正規の使い方
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines) — 見出し/インラインスタイル/innerHTML/Sentence case 規範
- `src/views/SettingsTab.tsx` — 置き換え対象の現行実装
