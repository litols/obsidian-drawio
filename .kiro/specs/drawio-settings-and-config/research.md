# リサーチログ: drawio-settings-and-config

## 調査スコープ

本スペックの設計に向け、以下の観点を調査した。

1. 上流 spec (plugin-foundation / drawio-embed-bridge) の公開 API とバウンダリ
2. per-diagram 設定の永続化方式の選定 (案 A: mxfile customData vs 案 B: sidecar)
3. Obsidian PluginSettingTab / Modal の React 統合パターン

## 調査結果

### 1. 上流 API の確認

#### plugin-foundation の提供 API

- `PluginSettings`: `{ [key: string]: unknown }` (インデックスシグネチャ) → `drawio` フィールドを型安全に追加可能
- `ReactMountManager`: `mount(container, component)` / `unmount(container)` / `unmountAll()`
- `ThemeModule`: `subscribeThemeChange(plugin, callback)` → dispose 関数を返す; `getCurrentTheme()` → `'light' | 'dark'`

#### drawio-embed-bridge の提供 API

- `DrawioBridge.setTheme(theme: 'light' | 'dark')` — `configure` アクションで drawio の `ui` 設定を更新
- `DrawioBridge.mount(container, opts: DrawioBridgeMountOptions)` — `DrawioUrlOptions` 経由で `lang` を渡せる
- `buildDrawioUrl` の `DrawioUrlOptions.lang` — drawio iframe URL に言語コードを付与
- `DrawioBridge.sendMessage(msg: DrawioOutbound)` — configure アクションで任意設定を注入可能

### 2. per-diagram 設定永続化方式の選定

#### 案 A: mxfile customData round-trip (却下)

- **仮説**: `<mxfile>` 要素に `customData` 属性 (JSON エンコード文字列) を埋め込み、drawio webapp が保存時にそのまま保持する
- **検証状況**:
  - 実機スパイクなしでは round-trip 安全性が不確か
  - drawio webapp (`vendor/drawio/src/main/webapp`) は保存時に EditorUi.createXmlForExport() 等で XML を再シリアライズするため、`mxfile` 直下の **未知の属性** が削除される実装パスが存在する。具体的には `mxFile.encode()` が `customData` を schema として認識せず drop する可能性
  - drawio-desktop のソースを grep した限り `customData` を mxfile レベルで永続化する公式機構は存在しない (`<UserObject>` レベルでは `customAttribute` があるが、これは個別の cell に対するもの)
  - drawio webapp の **メジャーバージョンアップ** (現在の vendor submodule pin から先に進める) で挙動が変わるリスクが高い
- **リスク**: 高。サイレントにデータ消失する可能性があり、ユーザは sidecar 不在 = 設定消失に気付きにくい
- **却下理由**: round-trip 検証が submodule のメジャー更新ごとに必要となり、保守コストと事故リスクが永続的に発生する。本 spec のスコープ (ローカル設定の信頼性ある永続化) に対し過剰なリスク

#### 案 B: sidecar `<filename>.drawio.json` (採用)

- **仮説**: ダイアグラムファイルと同ディレクトリに `<basename>.drawio.json` を並置する
- **検証状況**: Obsidian Vault API (`vault.adapter.read/write`) で確実に read/write できる。Vault 内ファイルなのでバックアップ対象にもなる
- **リスク**:
  - ユーザーが `.drawio.json` を誤って削除すると設定が消える → 許容 (graceful degradation: グローバル設定にフォールバック)
  - ファイル rename / move 時に sidecar も追従する必要 → `vault.on('rename')` で対応 (本 spec が責務を持つ; 要件 4.7)
  - ファイル delete 時に sidecar 残骸が残る → `vault.on('delete')` で対応 (要件 4.8)
  - `.drawio.json` が drawio formats reader (drawio-file-io) で誤読される → 拡張子レベルで `.json` を除外することで回避 (要件 4.10)
- **採用理由**: round-trip 安全性が担保でき、drawio webapp への依存がない。lifecycle 追従の実装責務は本 spec で完結

**決定: 案 B (sidecar) を採用。** 案 A への将来回帰の必要性が出た場合は別 spec で再評価する。

### 3. Obsidian PluginSettingTab の React 統合

- `display(containerEl)` で `createRoot(containerEl).render(<SettingsApp />)` し `hide()` で `unmount()` するパターンが Obsidian 公式 docs で推奨されている
- `ReactMountManager` はこのパターンの薄いラッパーとして plugin-foundation で提供されている
- `containerEl` は Obsidian が毎回同一要素を渡すため、container → root の Map で管理できる

### 4. drawio 言語コード正規化

drawio webapp がサポートする言語コード (drawio の `lang` URL パラメータ):
`en`, `de`, `fr`, `es`, `pt`, `ru`, `ja`, `zh`, `ko`, `pl`, `nl`, `it`

Obsidian の `moment.locale()` は IETF タグ (例: `ja-JP`) を返す場合があるため、先頭 2 文字で前方一致マッチし、未対応なら `en` フォールバックとする。

### 5. external-sync 統合ポイント

`drawio-external-sync` spec は `DrawioSettings` に以下のフィールドを追加することが期待される:
```typescript
externalSync?: {
  autoReloadWhenClean: boolean;
  notificationLevel: 'none' | 'notice' | 'status-bar';
};
```

本 spec は `DrawioSettings` interface を open-ended に定義せず、external-sync spec が `DrawioSettings` を intersection type で拡張するアプローチを推奨する。`migrateSettings` は `settingsVersion` の分岐で external-sync spec が追加した場合に対応できる構造にする。

SettingsTab は `<section data-spec="external-sync" />` を予約するだけで、実際の UI は external-sync spec が `DrawioSettingTab` を継承またはコンポジションで拡張して実装する。

## アーキテクチャ決定記録

| 決定 | 選択 | 理由 |
|------|------|------|
| per-diagram 永続化 | sidecar .drawio.json (案 B) | round-trip 安全性、drawio upstream 非依存 |
| テーマ追従 | ThemeBridge レイヤーに分離 | DrawioView と設定レイヤーの疎結合 |
| external-sync 統合 | UI セクション予約のみ | スキーマ定義は external-sync spec の責務 |
| 言語正規化 | 先頭 2 文字マッチ + en フォールバック | シンプルで保守しやすい |
