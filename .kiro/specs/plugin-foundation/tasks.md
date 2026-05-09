# Implementation Plan

並列マーカ `(P)` 付きタスクは同一フェーズ内で並列実行可能。各 atomic タスクには検証コマンドを `_Verify:_` として添付する。

- [ ] 1. ビルド構成とプロジェクト整理
- [x] 1.1 SPA テンプレートファイルの除去
  - `src/App.tsx`、`src/main.tsx`、`src/App.css`、`src/index.css` を削除する
  - `src/assets/` ディレクトリ (`hero.png`、`vite.svg`、`react.svg`) を削除する
  - `index.html` を削除する
  - _Verify:_ `git status` で対象ファイルが削除済みになっている / `ls src/` 出力に `App.tsx` 等が含まれない
  - _Requirements: 7.1_
  - _Boundary: プロジェクト構造_

- [x] 1.2 (P) package.json の整理
  - `scripts.dev` を `"vite build --watch"` に変更する
  - `scripts.build` を `"tsc -b && vite build"` のまま維持する
  - `scripts.preview` は削除する (lib モードでは無意味)
  - `obsidian` を `devDependencies` に追加する (`pnpm add -D obsidian`)
  - `vite-plugin-static-copy` を `devDependencies` に追加する (`pnpm add -D vite-plugin-static-copy`)
  - _Verify:_ `pnpm install` が成功し `pnpm-lock.yaml` が更新される / `pnpm ls obsidian vite-plugin-static-copy` で両者が解決される
  - _Requirements: 7.2, 7.3_
  - _Boundary: package.json_

- [ ] 1.3 (P) tsconfig.app.json の調整
  - `target` を `"ES2018"` に変更する
  - `lib` を `["ES2018", "DOM", "DOM.Iterable"]` に変更する
  - `types` を `["node"]` に変更する (`vite/client` は不要、Obsidian plugin はブラウザ環境で `import.meta.env` を使わない)
  - `verbatimModuleSyntax: true`、`erasableSyntaxOnly: true`、`strict` 相当設定を維持する
  - `module` / `moduleResolution` は `bundler` のまま (Vite が CJS 変換を担う)
  - _Verify:_ `pnpm exec tsc -b --noEmit` が型エラーなしで通過する
  - _Requirements: 7.4, 7.5_
  - _Boundary: TypeScript 設定_

- [ ] 1.4 (P) oxlint/oxfmt の dist/ 除外確認
  - `.oxlintrc.json` の `ignorePatterns` に `dist` が含まれていることを確認 (既に存在する)
  - oxfmt の format 対象から `dist/` を除外する設定があれば追加する (現状デフォルトで `node_modules` / `dist` は除外)
  - _Verify:_ `pnpm lint` が `dist/` を検査せず通過する / `pnpm format:check` が通過する
  - _Requirements: 7.6, 7.7_
  - _Boundary: Lint/Format 設定_

- [ ] 1.5 Vite build.lib 構成への全面書き換え
  - `vite.config.ts` を `build.lib` モードで再構成する
    - `lib.entry: 'src/main.ts'`、`lib.formats: ['cjs']`、`lib.fileName: () => 'main.js'`
    - `rollupOptions.external`: `['obsidian', 'electron', ...builtinModules, ...builtinModules.map((m) => 'node:' + m), /^@codemirror\//, /^@lezer\//]` (`import { builtinModules } from 'node:module'`)
    - `rollupOptions.output.exports: 'default'` を設定し `module.exports = ObsidianDrawioPlugin` 形式の出力を保証する
    - `build.target: 'es2018'`、`build.emptyOutDir: true`、`build.minify: 'esbuild'`、`build.sourcemap` は本番 false / dev は inline
  - `vite-plugin-static-copy` で `manifest.json`・`styles.css` を `dist/` へコピーする (`targets: [{ src: 'manifest.json', dest: '.' }, { src: 'styles.css', dest: '.' }]`)
  - React (`react`、`react-dom`) は external に含めない (バンドルに含める)
  - _Verify:_ プレースホルダ `src/main.ts` (`export default class P {}`) を一時配置して `pnpm build` 実行 → `dist/main.js` が CJS 形式で生成される
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 2.2, 2.3_
  - _Boundary: ViteConfig_

- [ ] 2. 配布物 (manifest.json / styles.css) の配置
- [ ] 2.1 (P) manifest.json の作成
  - プロジェクトルートに `manifest.json` を作成する
  - フィールド: `id: "obsidian-drawio"`、`name: "Drawio"`、`version: "0.1.0"`、`description`、`author`、`isDesktopOnly: true`、`minAppVersion: "1.4.0"`
  - `authorUrl` は任意 (空でも可)
  - _Verify:_ `node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"` がエラーなく成功
  - _Requirements: 2.1, 2.5, 2.6_
  - _Boundary: ManifestJson_

- [ ] 2.2 (P) styles.css の作成
  - プロジェクトルートに `styles.css` を作成する (コメントヘッダのみで可)
  - _Verify:_ `pnpm build` 後に `dist/styles.css` が存在する
  - _Requirements: 2.3_
  - _Boundary: StylesCss_

- [ ] 3. 横断 utility 層 (settings / theme / react-mount)
- [ ] 3.1 (P) PluginSettings 型と DEFAULT_SETTINGS の定義
  - `src/lib/settings.ts` を作成する
  - `export interface PluginSettings {}` を定義 (空 interface。後続 spec が宣言マージで拡張)
  - `export const DEFAULT_SETTINGS: PluginSettings = {}` を定義
  - _Verify:_ `pnpm exec tsc -b --noEmit` が通過する
  - _Requirements: 4.1, 4.4_
  - _Boundary: SettingsModule_

- [ ] 3.2 loadSettings / saveSettings ヘルパーの実装
  - `loadSettings(plugin: Plugin): Promise<PluginSettings>` を実装する
    - `const persisted = (await plugin.loadData()) ?? {}; return Object.assign({}, DEFAULT_SETTINGS, persisted);`
  - `saveSettings(plugin: Plugin, settings: PluginSettings): Promise<void>` を実装する
    - `await plugin.saveData(settings);` を呼ぶ
  - `import type { Plugin } from 'obsidian'` を使用する (verbatimModuleSyntax のため `import type` 必須)
  - _Verify:_ `pnpm exec tsc -b --noEmit` が通過する / `loadData()` が null を返すケースで `DEFAULT_SETTINGS` がマージされて返ることを単純な単体検査スクリプトで確認できる
  - _Requirements: 4.2, 4.3, 4.5, 4.6_
  - _Boundary: SettingsModule_

- [ ] 3.3 (P) getCurrentTheme 関数の実装
  - `src/lib/theme.ts` を作成する
  - `export type Theme = 'light' | 'dark'` を export する
  - `export function getCurrentTheme(): Theme` を実装する。`document.body.classList.contains('theme-dark') ? 'dark' : 'light'`
  - _Verify:_ `pnpm exec tsc -b --noEmit` が通過する
  - _Requirements: 5.1_
  - _Boundary: ThemeModule_

- [ ] 3.4 subscribeThemeChange 関数の実装
  - `subscribeThemeChange(plugin: Plugin, callback: (theme: Theme) => void): () => void` を実装する
  - 実装: `const ref = plugin.app.workspace.on('css-change', () => callback(getCurrentTheme())); return () => plugin.app.workspace.offref(ref);`
  - `plugin.registerEvent` は使用しない (subscriber が Plugin lifetime とは独立に dispose できるようにするため)
  - _Verify:_ `pnpm exec tsc -b --noEmit` が通過する / 戻り値の dispose 関数を呼んだ後 `css-change` で callback が発火しないことを手動検査できる
  - _Requirements: 5.2, 5.3, 5.4, 5.5_
  - _Boundary: ThemeModule_

- [ ] 3.5 (P) ReactMountManager の実装
  - `src/lib/react-mount.ts` を作成する
  - `ReactMountManager` interface (`mount(container, component): () => void`、`unmount(container): void`、`unmountAll(): void`) を export する
  - `createReactMountManager(): ReactMountManager` ファクトリを実装する
  - 内部で `Map<HTMLElement, Root>` を保持
  - `mount`: 既存 root があれば先に unmount → `createRoot(container).render(component)` → Map に追加 → 戻り値として `() => this.unmount(container)` を返す
  - `unmount`: 該当 root を `root.unmount()` し Map から削除
  - `unmountAll`: Map を iterate して全 root を unmount しクリア (途中エラーは `console.error` でログし継続)
  - `Root` 型は内部実装詳細とし、export しない
  - _Verify:_ `pnpm exec tsc -b --noEmit` が通過する / `mount` → 返却された dispose 呼び出しで Map が空になる動作を手動検査できる
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: ReactMountModule_

- [ ] 4. Plugin エントリポイントの実装
- [ ] 4.1 ObsidianDrawioPlugin クラスの骨格
  - `src/main.ts` を作成する
  - `obsidian` の `Plugin` を継承した `export default class ObsidianDrawioPlugin extends Plugin` を実装する
  - public プロパティ: `settings!: PluginSettings`、`reactMountManager!: ReactMountManager`
  - private プロパティ: `private disposers: Array<() => void> = []`
  - `async onload(): Promise<void>` と `onunload(): void` のスタブを宣言する (中身は後続タスク)
  - `async saveSettings(): Promise<void>` を実装し `await saveSettings(this, this.settings)` を呼ぶ
  - _Verify:_ `pnpm exec tsc -b --noEmit` が通過する / `pnpm build` で `dist/main.js` が生成され先頭または末尾に `module.exports` 相当が含まれる
  - _Requirements: 3.1_
  - _Boundary: ObsidianDrawioPlugin_

- [ ] 4.2 onload の実装
  - `this.settings = await loadSettings(this)` で設定をロード
  - `this.reactMountManager = createReactMountManager()` で React mount manager を初期化
  - `const dispose = subscribeThemeChange(this, (theme) => { /* 暫定 console.debug */ }); this.disposers.push(dispose);`
  - 例外は console.error でログするが Plugin ロード自体は失敗させない
  - _Verify:_ Obsidian で plugin を enable したときコンソールにエラーが出ない / `this.settings` が `DEFAULT_SETTINGS` を含む状態になる
  - _Requirements: 3.2, 4.2, 5.2_
  - _Boundary: ObsidianDrawioPlugin_

- [ ] 4.3 onunload の実装
  - `this.disposers` を逆順で iterate し各 dispose 関数を呼ぶ (try/catch で個別エラーをログし継続)
  - `this.reactMountManager?.unmountAll()` を呼ぶ
  - `this.disposers = []` でクリア
  - `innerHTML` を一切使用していないことを目視確認 (oxlint の `no-inner-html` 系ルールがあれば併用)
  - _Verify:_ `pnpm lint` が通過する / Obsidian で plugin を disable → enable を 3 回繰り返してメモリリークが起きない (DevTools heap snapshot で確認)
  - _Requirements: 3.3, 3.4, 5.4, 6.3_
  - _Boundary: ObsidianDrawioPlugin_

- [ ] 5. 統合検証
- [ ] 5.1 ビルド成果物の検証
  - `pnpm build` を実行し `dist/main.js`、`dist/manifest.json`、`dist/styles.css` の 3 ファイルが生成されることを確認
  - `dist/main.js` が CJS であることを確認: `head -c 200 dist/main.js` で `"use strict"` または `require(` を含む / `grep -c 'module.exports' dist/main.js` が 1 以上
  - `grep -c 'require("obsidian")' dist/main.js` が 1 以上 (external が機能している)
  - `grep -c 'require("react")' dist/main.js` が 0 (React はバンドル済み)
  - _Verify:_ 上記 4 点をすべて満たす
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.2, 2.3_
  - _Boundary: ViteConfig, ManifestJson, StylesCss_

- [ ] 5.2 (P) 型チェック / lint / format 通過確認
  - `pnpm build` (内部で `tsc -b` 込み) がエラーなしで完了
  - `pnpm lint` が通過 (`dist/` は除外されている)
  - `pnpm format:check` が通過
  - _Verify:_ 3 コマンドすべて exit 0
  - _Requirements: 1.2, 7.5, 7.7_
  - _Boundary: プロジェクト全体_

- [ ] 5.3 Obsidian での手動動作確認
  - `dist/` を Obsidian Vault の `.obsidian/plugins/obsidian-drawio/` にシンボリックリンク (`ln -s "$(pwd)/dist" "<vault>/.obsidian/plugins/obsidian-drawio"`) または手動コピー
  - Obsidian の Community Plugins 画面でプラグインが表示され Enable できることを確認
  - Enable → Disable → Enable を 3 回繰り返してもクラッシュ・メモリリークが起きない
  - DevTools コンソールに ERROR ログが出ない
  - _Verify:_ 上記 4 点を満たす (操作ログまたはスクリーンショットを残す)
  - _Requirements: 2.4, 3.2, 3.3_
  - _Boundary: ObsidianDrawioPlugin, ManifestJson_
