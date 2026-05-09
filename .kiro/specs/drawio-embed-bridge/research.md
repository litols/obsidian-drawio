# Research & Design Decisions: drawio-embed-bridge

## Summary
- **Feature**: `drawio-embed-bridge`
- **Discovery Scope**: Complex Integration (新規ブリッジ層の確立)
- **Key Findings**:
  - draw.io は npm パッケージとして公開されておらず、`jgraph/drawio` の `src/main/webapp` をそのまま iframe 読み込みする方法が唯一の現実的選択肢
  - Obsidian Electron renderer の `app://` プロトコルは `app.vault.adapter.getResourcePath()` で取得でき、iframe src に使用可能
  - postMessage プロトコルは `proto=json` モードで JSON シリアライズされ、draw.io 公式の Embed 仕様 (`event`/`action` フィールド) に従う
  - drawio-desktop (jgraph/drawio-desktop) が同じ postMessage + iframe アーキテクチャを採用しており、設計の参考として流用可能
  - `vite-plugin-static-copy` の `targets` に `vendor/drawio/src/main/webapp` → `dist/drawio` を追加することで配布パイプライン実現

## Research Log

### draw.io postMessage プロトコル仕様

- **Context**: `DrawioBridge` の型定義に必要な全 inbound/outbound メッセージ種別の特定
- **Sources Consulted**: draw.io 公式 GitHub wiki (Embed Mode), drawio-desktop IPC コード
- **Findings**:
  - **Inbound (draw.io → host)**: `init`, `load`, `autosave`, `save`, `export`, `exit`, `dialog`, `prompt`
  - **Outbound (host → draw.io)**: `load` (xml注入), `merge`, `configure`, `layout`, `exportpdf`
  - `init` イベントを受信後に `{action:'load', xml}` を返すのが初期化フロー
  - `proto=json` パラメータで JSON ペイロードが有効になる
  - `embed=1` パラメータで Embed モードが有効になり save/exit ボタンの挙動が変わる
- **Implications**: `DrawioInbound` を `event` フィールドの discriminated union、`DrawioOutbound` を `action` フィールドの discriminated union として設計する

### Obsidian Electron CSP と iframe 読み込み

- **Context**: `file://` または `app://` プロトコルで drawio webapp を iframe に読み込む可否の検証
- **Sources Consulted**: Obsidian API ドキュメント, drawio-desktop Electron main プロセス設定
- **Findings**:
  - `app.vault.adapter.getResourcePath(path)` が `app://` 形式の絶対 URL を返す
  - Obsidian の CSP は `app://` オリジンに対して `script-src 'self'` を許可している可能性が高い
  - `file://` は同オリジン制約で postMessage を受信できない場合がある
  - `sandbox="allow-scripts allow-same-origin allow-downloads"` を指定することで必要最低限の権限を付与できる
  - CSP 違反が発生する場合は `webview` タグや `app://` プロトコルハンドラ登録が代替案
- **Implications**: `getResourcePath` を使った `app://` URL を第一案とし、フォールバックとして `file://` を試す。CSP 違反時の警告ログを実装する

### vite-plugin-static-copy による配布パイプライン

- **Context**: drawio webapp の数十 MB を production build のみ dist/ にコピーし、watch モードでは軽量にしたい
- **Findings**:
  - `vite-plugin-static-copy` は `targets` 配列でコピールールを設定できる
  - `command` オプションで `build` 時のみコピーを実行できる (watch 除外可能)
  - watch モードでは symlink (`ln -s`) または `copyPublicDir: false` + 別途 symlink スクリプトで対応可能
  - `vendor/drawio/src/main/webapp` → `dist/drawio` のマッピングが必要
- **Implications**: `vite.config.ts` の `viteStaticCopy` 設定に `{ src: 'vendor/drawio/src/main/webapp/**', dest: 'drawio' }` を追加。watch モード除外は `process.env.NODE_ENV !== 'production'` で分岐

### git submodule 運用ポリシー

- **Context**: upstream jgraph/drawio への追従方法と再現性確保
- **Findings**:
  - `git submodule add https://github.com/jgraph/drawio.git vendor/drawio` で追加
  - 初回は特定コミット/タグ (例: v24.x) に固定: `git -C vendor/drawio checkout <tag>`
  - `.gitmodules` に `shallow = true` は optional (ただし drawio リポジトリは大きいため推奨)
  - upstream 追従は手動: `git submodule update --remote vendor/drawio` + コミット更新
  - CI では `git submodule update --init --recursive` が必要
- **Implications**: README および CONTRIBUTING に submodule 初期化手順を記載する。固定コミット SHA を `.gitmodules` ではなく `git submodule` の通常追跡で管理する

## Architecture Pattern Evaluation

| Option | 説明 | 強み | リスク / 制限 | 備考 |
|--------|------|------|--------------|------|
| iframe + postMessage | drawio webapp をそのまま iframe で読み込み、JSON postMessage で通信 | 追加ビルド不要、drawio-desktop と同アーキテクチャ | CSP / sandbox 制約、数十 MB のファイルコピー | **採用** |
| mxgraph 直接 import | mxgraph を npm install してキャンバス描画 | バンドルサイズ最小化可能 | drawio UI (パレット/ツール) の再実装が必要で工数が桁違い | 却下 |
| drawio npm fork | drawio を fork して npm パッケージ化 | 依存管理が容易 | 保守コスト恒常化、upstream 追従が困難 | 却下 |

## Design Decisions

### Decision: postMessage 受信元の検証方式

- **Context**: `window.addEventListener('message', ...)` で全オリジンのメッセージを受信してしまうリスク
- **Alternatives Considered**:
  1. `event.origin === '*'` — 検証なし、全メッセージを受信
  2. `event.source === iframe.contentWindow` — 送信元 window オブジェクトで検証
- **Selected Approach**: `event.source === iframe.contentWindow` による検証
- **Rationale**: origin が `file://` や `app://` の場合、文字列比較が不安定になる。`contentWindow` 参照比較は確実
- **Trade-offs**: `contentWindow` が null になる可能性 (iframe がまだロードされていない) は null チェックで対処

### Decision: DrawioInbound / DrawioOutbound の型設計

- **Context**: downstream spec (file-io, settings) が型を import して使う共有契約
- **Alternatives Considered**:
  1. `event: string` のゆるい型 — 実装が容易だが型安全性が低い
  2. discriminated union — 各メッセージ種別を個別の型で表現
- **Selected Approach**: discriminated union (`event` / `action` フィールドで識別)
- **Rationale**: TypeScript の型絞り込みが機能し、downstream spec がメッセージ種別ごとに安全にハンドリングできる
- **Trade-offs**: 型定義が verbose になるが、`any` 回避と型安全性を優先

### Decision: drawio の配布パイプライン (production のみコピー)

- **Context**: drawio webapp は数十 MB あり、watch モードのたびに全コピーは遅い
- **Selected Approach**: `vite-plugin-static-copy` で production build 時のみ `vendor/drawio/src/main/webapp` を `dist/drawio/` にコピー。watch モードでは symlink を手動で張る手順を README に記載
- **Rationale**: watch モードのビルド速度を維持しつつ、production には完全なファイルセットを含める

## Risks & Mitigations

- **CSP 制約で drawio iframe がスクリプトをブロック** — 初期スパイクで `getResourcePath()` による `app://` URL を実機で疎通確認する。失敗時は `webview` タグまたは `app://` プロトコルハンドラ登録を代替手段として検討
- **drawio webapp のバンドルサイズ** — production build のみコピー、watch モードは symlink で対処
- **postMessage 受信競合 (他の iframe)** — `event.source === iframe.contentWindow` 比較で確実に絞り込む
- **submodule 初期化忘れ** — `pnpm install` の `postinstall` スクリプトで `git submodule update --init` を自動実行することを検討。または README に明記

## References

- draw.io Embed Mode 仕様 (GitHub Wiki) — postMessage プロトコルの全メッセージ種別定義
- drawio-desktop IPC 実装 — 同アーキテクチャの参考実装
- Obsidian Plugin API (`app.vault.adapter.getResourcePath`) — `app://` URL 取得方法
- vite-plugin-static-copy ドキュメント — `targets` および `command` オプション
