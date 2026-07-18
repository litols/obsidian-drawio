# Requirements Document

## Project Description (Input)
プラグインの設定画面のレイアウトが崩れている問題を、Obsidian 公式 dev docs のガイドラインに沿って修正する。現状の設定画面は Obsidian の Setting API を使わず React で生の HTML を描画しているため、Obsidian 標準の設定行スタイルが一切適用されていない。Obsidian 標準の Setting API ベースの実装に置き換え、ガイドライン (トップレベル見出し禁止、インラインスタイル禁止、CSS 変数使用、Sentence case 等) に準拠した設定画面にする。

## Introduction

本機能は、obsidian-drawio プラグインの設定タブを Obsidian 公式ガイドラインに準拠した表示構造へ作り直す。現状の設定タブは Obsidian 標準の設定行スタイルが適用されず、ラベルとコントロールが未整列のまま縦積みされ、テーマにも追従しない。既存の設定項目・値・保存挙動は一切変えず、表示と操作体験のみを標準準拠に修正する。

## Boundary Context

- **In scope**: 設定タブの表示構造・スタイルの Obsidian ガイドライン準拠化、既存設定項目とその操作 (追加・削除・リセット・バリデーション) の維持、テーマ追従。
- **Out of scope**: 設定データモデル (`PluginSettings.drawio`) の変更、新規設定項目の追加 (外部同期の操作コントロール、UI 言語選択は plugin-i18n spec の所掌)、設定タブ以外の画面。
- **Adjacent expectations**: 並行 spec `drawio-preview-mode` が既定表示モード項目を追加する。後続 spec `plugin-i18n` が UI 言語項目を追加する予定。本機能はこれらの項目追加を同じ標準レイアウトで受け入れられる構造を提供し、既存の i18n 文言 (en/ja) を引き続き使用する。

## Requirements

### Requirement 1: Obsidian 標準レイアウトへの準拠
**Objective:** As a Obsidian ユーザー, I want 設定画面が Obsidian の他の設定と同じ見た目・配置で表示されること, so that 違和感なく設定を読み取り、操作できる

#### Acceptance Criteria
1. When ユーザーがプラグイン設定タブを開いたとき, the Settings Tab shall 各設定項目を Obsidian 標準の設定行構造 (項目名・説明・コントロールが整列した行) で表示する
2. The Settings Tab shall プラグイン名や「General」「Settings」等のトップレベル見出しを表示しない
3. The Settings Tab shall セクション区切りを Obsidian 標準の設定見出しスタイルで表示する
4. The Settings Tab shall 文字色・背景・余白を Obsidian のテーマ変数に追従させ、ライト/ダークテーマの双方で崩れなく表示する
5. The Settings Tab shall すべての UI 文言を既存の i18n 文言 (en/ja) 経由で表示する

### Requirement 2: 既存設定項目と操作の完全維持
**Objective:** As a 既存ユーザー, I want 見た目の修正後もすべての設定項目と操作がそのまま使えること, so that 設定内容や運用を変えずに移行できる

#### Acceptance Criteria
1. The Settings Tab shall 修正前に提供していたすべての設定項目 (常設ライブラリ、カスタムライブラリ、保存形式、真偽値設定群、drawio 表示言語) を引き続き提供する
2. When ユーザーが設定値を変更したとき, the Settings Tab shall 変更を即座に永続化する (既存挙動の維持)
3. When ユーザーがライブラリ一覧に項目を追加・削除・リセットしたとき, the Settings Tab shall 既存と同じ結果 (重複排除、既定値へのリセットを含む) を設定へ反映する
4. If 不正なライブラリパス (外部 URL・絶対パス・空文字) が入力された場合, the Settings Tab shall テーマに調和したスタイルでエラーメッセージを表示し、値を追加しない
5. When 設定タブを閉じて再度開いたとき, the Settings Tab shall 保存済みの設定値を正しく表示する

### Requirement 3: 隣接機能の設定項目の受け入れ
**Objective:** As a プラグイン開発者, I want 他機能が追加する設定項目が同じ標準レイアウトに載ること, so that 機能追加のたびに設定画面が崩れない

#### Acceptance Criteria
1. Where 他機能の spec (既定表示モード等) が設定項目を追加している場合, the Settings Tab shall その項目を同じ標準の設定行構造で表示する
2. The Settings Tab shall 外部同期セクションの見出しと説明文を標準スタイルで維持する (操作コントロールの追加は行わない)
