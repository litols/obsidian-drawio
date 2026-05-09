# Research Log: plugin-foundation

## Discovery Scope

**Feature Type**: New Feature (greenfield — SPA テンプレートを Obsidian プラグイン基盤へ全面置換)  
**Discovery Process**: Full discovery

## Codebase Analysis

### 現状のファイル構成

- `src/App.tsx`, `src/main.tsx`, `src/index.css`, `src/App.css` — Vite SPA テンプレート (除去対象)
- `src/assets/` — SPA テンプレートアセット (除去対象)
- `index.html` — SPA エントリ (除去対象)
- `vite.config.ts` — SPA 向け設定 (`plugins: [react()]` のみ、lib モード未設定)
- `tsconfig.app.json` — `target: "es2023"`, `module: "esnext"`, `lib: ["ES2023", "DOM"]`, `verbatimModuleSyntax: true`, `erasableSyntaxOnly: true`
- `package.json` — `type: "module"`, `obsidian` 未インストール

### 変更が必要な既存ファイル

| ファイル | 変更内容 |
|---------|---------|
| `vite.config.ts` | `build.lib` モード + `rollupOptions.external` + `vite-plugin-static-copy` 追加 |
| `tsconfig.app.json` | `target: "es2018"`, `module: "commonjs"`, `lib` に Node.js 型追加 |
| `tsconfig.json` | Node 設定を plugin 向けに調整 |
| `package.json` | scripts 変更、`obsidian` を devDependencies に追加、`vite-plugin-static-copy` 追加 |

## 技術調査

### Obsidian Plugin API パターン

obsidian-sample-plugin の標準パターン:
- `main.ts`: `Plugin` を継承したクラス、`onload`/`onunload` を実装
- `manifest.json`: プラグインメタデータ
- Vite `build.lib` モードで CJS 出力
- `rollupOptions.external`: `['obsidian', 'electron', ...]`

### Vite build.lib 設定

```typescript
import { builtinModules } from 'node:module';

build: {
  target: 'es2018',
  emptyOutDir: true,
  minify: 'esbuild',
  lib: {
    entry: 'src/main.ts',
    formats: ['cjs'],
    fileName: () => 'main.js',
  },
  rollupOptions: {
    external: [
      'obsidian', 'electron',
      ...builtinModules,
      ...builtinModules.map((m) => `node:${m}`),
      /^@codemirror\//, /^@lezer\//,
    ],
    output: { exports: 'default' }, // module.exports = ObsidianDrawioPlugin
  },
}
```

### テーマ検出パターン

Obsidian テーマは `document.body` クラスで検出:
- `theme-dark` クラスあり → dark
- `theme-dark` クラスなし → light

変更検知は `app.workspace.on('css-change', callback)` で購読。

### React 統合パターン (Obsidian 公式ドキュメント準拠)

```typescript
// マウント
const root = createRoot(containerEl);
root.render(<MyComponent />);

// アンマウント
root.unmount();
```

`onunload()` での cleanup が必須。

## 設計決定

### 決定1: `vite-plugin-static-copy` で manifest.json/styles.css を dist/ へ搬入

- **理由**: Vite lib モードは HTML を出力しない。静的ファイルを dist/ に含めるには `vite-plugin-static-copy` が最もシンプル
- **代替案**: `rollupOptions.plugins` でカスタムプラグイン → 複雑すぎる

### 決定2: `PluginSettings` は空のオブジェクト型として初期定義

- **理由**: 後続 spec が型を拡張できるよう最小構成で定義。破壊変更を防ぐため
- **影響**: drawio-settings-and-config spec が `PluginSettings` にフィールドを追加する

### 決定3: `react-mount.ts` は root を Map で管理

- **理由**: 複数の React root (将来の View など) を一元管理し `onunload()` で全 root を確実に unmount するため
- **インターフェース**: `mount(el: HTMLElement, component: ReactNode): () => void` を提供

### リスク

- Obsidian の CSP が React のインライン style に干渉する可能性 → 初期検証で確認必要
- `erasableSyntaxOnly: true` + CJS 出力の組み合わせで型消去問題が発生する可能性 → Vite が TypeScript を処理するため問題なし
