# Technology Stack

## Architecture

クライアントサイド SPA。Vite による開発サーバ / 本番バンドル、React 19 によるレンダリング。
バックエンドは未定 (Obsidian プラグイン化する場合はサーバ不要、Vault ファイルを直接扱う)。

## Core Technologies

- **Language**: TypeScript (strict + bundler resolution)
- **Framework**: React 19 (`react-jsx` runtime, `StrictMode` 有効)
- **Build / Dev**: Vite 8 + `@vitejs/plugin-react` (Oxc ベース)
- **Runtime**: Node.js (型は `@types/node` v24 系を採用) / モダンブラウザ (target `es2023`)

## Key Libraries

依存はランタイム最小構成 (`react`, `react-dom`)。状態管理・ルーティング・UI フレームワークは未導入。
追加する場合はこのファイルに採用理由とともに追記する。

## Development Standards

### Type Safety
- `tsconfig.app.json`: `noUnusedLocals` / `noUnusedParameters` / `noFallthroughCasesInSwitch` 有効
- `verbatimModuleSyntax: true` — `import type` を明示する必要あり
- `erasableSyntaxOnly: true` — `enum` や `namespace` など型消去できない構文は禁止
- `allowImportingTsExtensions: true` — `.tsx` 拡張子付き import を許可 (例: `App.tsx`)

### Code Quality
- **Linter**: `oxlint` (`correctness: error`, plugins: react / typescript / unicorn / oxc)
- **Formatter**: `oxfmt` (Markdown / CSS / JSON はフォーマット対象外)
- ESLint / Prettier は使わない — Oxc 系ツールチェーンに統一

### Testing
- 未導入。導入時はこのセクションを更新する。

## Development Environment

### Required Tools
- Node.js (Vite 8 / TS 6 系が動作するバージョン)
- pnpm (lockfile が `pnpm-lock.yaml`)

### Common Commands
```bash
pnpm dev           # 開発サーバ
pnpm build         # tsc -b で型チェック後 vite build
pnpm lint          # oxlint
pnpm format        # oxfmt (書き換え)
pnpm format:check  # oxfmt --check (CI 向け)
pnpm preview       # build 成果物のプレビュー
```

## Key Technical Decisions

- **Oxc ツールチェーン採用**: ESLint/Prettier ではなく `oxlint` + `oxfmt` を使用。高速性と Vite React プラグイン (Oxc 版) との一貫性が理由。
- **React 19 + StrictMode**: 開発時に副作用検出を強制。
- **TypeScript bundler resolution**: Vite 前提。Node 解決は使わない。
- **Path alias 未設定**: `@/` などのエイリアスは現時点で未導入。導入する場合は `tsconfig` と Vite 設定の両方を更新する。

---
_Document standards and patterns, not every dependency_
