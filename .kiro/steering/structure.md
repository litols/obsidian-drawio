# Project Structure

## Organization Philosophy

現状はテンプレート由来のフラット構成。機能追加に伴い **feature-first** (機能単位ディレクトリ) へ拡張する想定。
`src/` 直下にエントリポイントを置き、ドメイン固有のロジックはサブディレクトリへ分離する。

## Directory Patterns

### Application Source
**Location**: `/src/`
**Purpose**: アプリ本体のソース。エントリは `main.tsx` → `App.tsx`。
**Example**: `src/App.tsx`, `src/main.tsx`, `src/index.css`

### Static Assets (bundled)
**Location**: `/src/assets/`
**Purpose**: import 経由でバンドルする画像・SVG。コンポーネントから相対 import する。
**Example**: `import heroImg from "./assets/hero.png"`

### Static Assets (served as-is)
**Location**: `/public/`
**Purpose**: ビルド時にそのまま配信するファイル。ルート絶対パスで参照する。
**Example**: `<use href="/icons.svg#documentation-icon" />`

### Specs / Steering
**Location**: `.kiro/steering/`, `.kiro/specs/`
**Purpose**: プロジェクトメモリ (本ファイル群) と機能仕様。

## Naming Conventions

- **Component files**: `PascalCase.tsx` (例: `App.tsx`)
- **Non-component TS files**: `camelCase.ts` 想定 (現時点でサンプルなし)
- **CSS files**: 対応するコンポーネントと同名 (例: `App.tsx` ↔ `App.css`)
- **Assets**: `kebab-case` または `lowercase` (例: `hero.png`, `react.svg`)

## Import Organization

```typescript
// 1. 外部ライブラリ
import { useState } from "react";

// 2. ローカルアセット / モジュール (相対パス)
import reactLogo from "./assets/react.svg";
import App from "./App.tsx";   // .tsx 拡張子付きを許可

// 3. スタイル (副作用 import を最後)
import "./App.css";
```

**Path Aliases**:
- 未設定。必要になった時点で `tsconfig.app.json` と `vite.config.ts` の両方を更新する。

**Import Type**:
- `verbatimModuleSyntax` 有効のため、型のみの import は `import type { Foo } from "..."` と明示する。

## Code Organization Principles

- **エントリは薄く保つ**: `main.tsx` は `createRoot` と `<App />` のみ。アプリロジックは `App.tsx` 以降に置く。
- **副作用 import (CSS など) はファイル末尾**: 実装 import との視覚的区別を維持。
- **`public/` と `src/assets/` の使い分け**:
  - バンドラに最適化させたい (ハッシュ化・tree-shake) → `src/assets/`
  - URL を固定したい / SVG sprite として `<use href>` で参照する → `public/`

---
_Document patterns, not file trees. New files following patterns shouldn't require updates_
