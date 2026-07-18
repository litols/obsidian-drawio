# Requirements Document

## Project Description (Input)
drawio ファイルを開いたときにデフォルトでフルエディタを起動するのではなく、拡大縮小・パン操作可能な軽量プレビューを表示する。edit mode に入ったときのみフル drawio エディタを起動する。プレビューはハイブリッド方式: .drawio.svg / .drawio.png は内包済みレンダリング画像を直接表示し、.drawio (XML) は軽量ビューアでレンダリングする。あわせて drawio アセットの読み込み管理を強化しパフォーマンスを改善する (現状はファイルを開くたびにエディタ用アセット一式を全ファイル再帰読み込みしている)。

## Introduction

本機能は、Obsidian 内で draw.io ダイアグラムファイル (`.drawio` / `.drawio.svg` / `.drawio.png`) を開いたときの既定動作を「フルエディタ起動」から「読み取り専用プレビュー表示」へ変更する。プレビューは拡大縮小・パン操作に対応し、ユーザーが明示的に編集モードへ入ったときにのみフルエディタを起動する。これにより、閲覧目的でファイルを開く際の待ち時間とリソース消費を大幅に削減する。あわせて、エディタ用アセットの読み込み管理を改善し、同一セッション内でのエディタ再起動を高速化する。

## Boundary Context

- **In scope**: ダイアグラムファイルを開いたときのプレビュー表示、プレビュー上の閲覧操作 (拡大縮小・パン・ページ切替)、プレビューとエディタ間のモード遷移、プレビュー表示中の外部変更追従、エディタ用アセットの読み込み効率化、既定表示モードの設定項目。
- **Out of scope**: 設定画面全体の再構築 (別 spec `settings-ui-refresh` が担当)、Markdown ノート内への図の埋め込みプレビュー、drawio エディタ本体の機能変更、ファイル形式の読み書き仕様の変更。
- **Adjacent expectations**: 編集モード中の保存・自動保存・外部変更検知の挙動は既存仕様 (drawio-file-io / drawio-external-sync) を維持する。本機能はそれらの挙動を変更しない。

## Requirements

### Requirement 1: プレビュー優先のファイルオープン
**Objective:** As a Obsidian ユーザー, I want ダイアグラムファイルを開いたときに軽量なプレビューが即座に表示されること, so that 閲覧だけしたいときにエディタの起動を待たずに内容を確認できる

#### Acceptance Criteria
1. When ユーザーが `.drawio` / `.drawio.svg` / `.drawio.png` ファイルを開いたとき, the Drawio View shall フルエディタではなく読み取り専用プレビューを表示する
2. When `.drawio.svg` または `.drawio.png` ファイルをプレビュー表示するとき, the Drawio View shall ファイルに内包されたレンダリング済み画像を用いて図を表示する
3. When `.drawio` (XML) ファイルをプレビュー表示するとき, the Drawio View shall ファイル内の図データを描画して表示する
4. Where 設定の既定表示モードが「エディタ」に変更されている場合, the Drawio View shall ファイルを開いたときに従来どおりフルエディタを直接起動する
5. If プレビューの描画に失敗した場合, the Drawio View shall エラーメッセージとともに「エディタで開く」手段を提示する

### Requirement 2: プレビューの閲覧操作
**Objective:** As a Obsidian ユーザー, I want プレビュー上で図を自由に拡大縮小・移動して閲覧できること, so that 大きな図や細部を快適に確認できる

#### Acceptance Criteria
1. When ユーザーがプレビュー上でズーム操作 (修飾キー+ホイール、ピンチ、またはズームボタン) を行ったとき, the Drawio View shall 図の表示を拡大または縮小する
2. When ユーザーがプレビュー上でドラッグまたはスクロール操作を行ったとき, the Drawio View shall 図の表示位置を移動する
3. When プレビューを最初に表示したとき, the Drawio View shall 図全体がビュー領域に収まる倍率で表示する
4. Where 図が複数ページを含む場合, the Drawio View shall ページを切り替える手段を提供する
5. The Drawio View shall プレビュー表示中にファイル内容を一切変更しない

### Requirement 3: 編集モードへの遷移と復帰
**Objective:** As a Obsidian ユーザー, I want 明示的な操作で編集モードに入り、編集後はプレビューに戻れること, so that 閲覧と編集を意図どおりに使い分けられる

#### Acceptance Criteria
1. When ユーザーがビューの編集アクション (ビューヘッダのアクション、コマンドパレット、またはプレビューのダブルクリック) を実行したとき, the Drawio View shall フル drawio エディタを起動して編集モードへ遷移する
2. While エディタの起動処理が進行中のとき, the Drawio View shall ローディング表示を提示する
3. When ユーザーが編集モードからプレビューへ戻る操作を実行したとき, the Drawio View shall 保存済みの最新内容でプレビューを再描画する
4. While 編集モードで未保存の変更が処理中のとき, when ユーザーがプレビューへ戻る操作を実行したとき, the Drawio View shall 変更内容の保存を完了させてからプレビューへ遷移する
5. While 編集モードのとき, the Drawio View shall 保存・自動保存・外部変更検知について既存のエディタ挙動を維持する

### Requirement 4: プレビュー表示中の外部変更追従
**Objective:** As a Obsidian ユーザー, I want プレビュー表示中にファイルが外部で更新されたら表示が自動で追従すること, so that 常に最新の図を確認できる

#### Acceptance Criteria
1. While プレビュー表示中のとき, when 表示対象ファイルが外部で変更されたとき, the Drawio View shall 最新のファイル内容でプレビューを自動的に再描画する
2. While プレビュー表示中のとき, when 表示対象ファイルがリネームされたとき, the Drawio View shall 新しいファイルパスを追跡して表示を継続する
3. While プレビュー表示中のとき, when 表示対象ファイルが削除されたとき, the Drawio View shall ユーザーへ通知しビューを閉じる

### Requirement 5: 読み込みパフォーマンス
**Objective:** As a Obsidian ユーザー, I want 閲覧時に重いエディタ読み込みが発生せず、エディタ再起動も速いこと, so that 大量の図を扱っても Obsidian が軽快に動作する

#### Acceptance Criteria
1. When プレビューモードでファイルを開いたとき, the Drawio View shall フルエディタ用アセット一式の読み込みを行わない
2. When 同一 Obsidian セッション内で 2 回目以降にフルエディタを起動したとき, the Drawio Plugin shall 初回起動時に読み込んだエディタ用アセットを再利用し、全アセットのディスク再読み込みを行わない
3. If エディタ用アセットの再利用ができない状態でエディタ起動が要求された場合, the Drawio Plugin shall アセットを読み込み直してエディタを起動する
4. When プラグインが無効化されたとき, the Drawio Plugin shall 保持していたアセット資源を解放する

### Requirement 6: 既定表示モードの設定
**Objective:** As a Obsidian ユーザー, I want ファイルを開いたときの既定モードを設定で選べること, so that 自分のワークフロー (閲覧中心 / 編集中心) に合わせられる

#### Acceptance Criteria
1. The Drawio Plugin shall 設定画面で既定表示モード (プレビュー / エディタ) の選択肢を提供する
2. The Drawio Plugin shall 既定表示モードの初期値をプレビューとする
3. When 既定表示モードの設定を変更した後に新たにファイルを開いたとき, the Drawio View shall 変更後の設定に従った表示モードで開く
