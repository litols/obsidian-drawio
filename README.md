# obsidian-drawio

Obsidian desktop plugin for viewing and editing draw.io diagrams
(`.drawio`, `.drawio.svg`, `.drawio.png`) directly inside the Obsidian editor.

> **Status**: under active development. Spec-driven via the kiro workflow
> in `.kiro/specs/`.

## Installation

Releases are built automatically by GitHub Actions (`.github/workflows/release.yml`
for tagged versions, `nightly.yml` for the rolling nightly build).

### Manual install (recommended — fully working)

1. Open the [Releases](https://github.com/litols/obsidian-drawio/releases) page and
   download `obsidian-drawio-<version>.zip` from the version you want (or from the
   `nightly` pre-release for the latest build).
2. Extract it into `<your-vault>/.obsidian/plugins/` — it unpacks to an
   `obsidian-drawio/` folder.
3. Reload Obsidian and enable **Drawio** under Settings → Community plugins.

### Obsidian BRAT

Add `litols/obsidian-drawio` in [BRAT](https://github.com/TfTHacker/obsidian42-brat).
For the nightly channel, enable pre-release / beta updates in BRAT so it tracks the
`nightly` tag; each nightly ships an auto-incrementing `-nightly.<timestamp>` version
so BRAT detects updates without a manual version bump.

> **Note:** BRAT only downloads `main.js`, `manifest.json` and `styles.css`. This
> plugin also needs `iframe-init.js` and the bundled draw.io web app (the `drawio/`
> folder, ~150&nbsp;MB), which BRAT cannot fetch yet. Until runtime asset download is
> implemented, a BRAT install alone cannot render diagrams — use the manual zip above
> for a fully working setup.

### Releasing (maintainers)

Push a version tag (Obsidian convention: no `v` prefix, matching `manifest.json`):

```bash
git tag 0.2.0
git push origin 0.2.0
```

or trigger **Release** from the Actions tab and enter the version. Each release
publishes the three BRAT files plus the full `obsidian-drawio-<version>.zip`.

## Features (planned / in progress)

- Open and edit `.drawio` / `.drawio.svg` / `.drawio.png` files in an
  embedded draw.io editor (drawio-file-io spec)
- Plugin settings: theme follow, default libraries, save format, etc.
  (drawio-settings-and-config spec)
- External-change detection with auto-reload and conflict resolution
  for AI-agent-driven workflows (drawio-external-sync spec)

## Bundles draw.io

This plugin bundles the upstream [draw.io](https://github.com/jgraph/drawio)
webapp ([Apache-2.0](https://github.com/jgraph/drawio/blob/master/LICENSE))
as a git submodule pinned to **`v29.7.12`** (commit
`c9904435fd1a6795f6cad5c3908ec89d9afb8fb1`).

The bundled `LICENSE` is shipped at `dist/drawio/LICENSE`. Upstream does
not include a `NOTICE` file at this tag, so none is bundled.

### Submodule initialization

When cloning fresh:

```bash
git clone --recurse-submodules <this-repo>
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

The submodule is configured with `shallow = true` to keep clone size small.

### Updating the bundled draw.io

Tag updates are **manual** (not done automatically by `--remote`):

```bash
cd vendor/drawio
git fetch --tags
git checkout <new-tag>
cd ../..
git add vendor/drawio
```

Bump the tag in `.kiro/specs/drawio-embed-bridge/research.md` (Vendor Submodule section)
and this README at the same time.

## Development

```bash
pnpm install                  # install deps; expects submodules already initialized
pnpm dev                      # vite build --watch
pnpm build                    # tsc -b && vite build
pnpm lint                     # oxlint
pnpm format                   # oxfmt
pnpm format:check             # oxfmt --check
```

Output goes to `dist/` (`main.js` + `manifest.json` + `styles.css` +
`drawio/` static webapp). To install into a Vault:

```bash
ln -s "$(pwd)/dist" "<your-vault>/.obsidian/plugins/obsidian-drawio"
```

Then enable "Drawio" in Obsidian → Settings → Community plugins.

## Testing

### 前提条件

- Node.js v22 以上 / pnpm
- E2E は **macOS のみサポート** (Linux / Windows は将来対応)
- E2E 実行には `/Applications/Obsidian.app` がローカルに存在することが前提
  - `OBSIDIAN_APP_PATH` env で別パスへ上書き可能
- `vendor/drawio` submodule が初期化済 (`git submodule update --init --recursive`)
- プラグインのビルド成果物が `dist/` に生成されている (`pnpm build`)

### Unit Test (vitest)

```bash
pnpm test         # 1 回実行 (CI 同等)
pnpm test:watch   # 監視モード
```

`src/**/*.test.ts` パターンを対象。obsidian / electron / vendor/drawio に直接依存するロジック (`DrawioView`、`drawio-bridge` の postMessage 送受信、`SettingsTab` のレンダリング、`ExternalWatcher` の Vault イベント配線など) は Unit Test の対象外で、E2E でカバーする方針。

### E2E (Playwright + Electron)

初回セットアップ (Obsidian バイナリの抽出 + vault の trust 突破):

```bash
bash scripts/setup-obsidian.sh    # /Applications/Obsidian.app から app.asar を抽出
pnpm build                         # main.js / manifest.json / styles.css / drawio/ を dist へ
pnpm e2e:setup                     # 初回: trust author ダイアログ突破 + workspace.json 生成
```

E2E 実行:

```bash
pnpm e2e          # 通常実行
pnpm e2e --ui     # Playwright Inspector / UI モードで debug
pnpm e2e:cleanup  # workspace.json 等の実行時生成物を初期状態にリセット
```

### CI

- PR と main push で `.github/workflows/ci.yml` が `basic` (ubuntu-latest) と `e2e` (macos-latest) の 2 job を並列実行
- `OBSIDIAN_VERSION` env で固定 pin。Obsidian binary は `.dmg` から抽出しキャッシュ
- 双方が green になることを main merge の条件にする運用 (リポジトリ管理者が GitHub UI の branch protection で `basic` / `e2e` を required check に指定)
- E2E 失敗時は Playwright trace と screenshot を artifact として保存

### スコープ外

- drawio webapp 内部のパレット / 図形追加 / 編集ツールなど深いシナリオの自動化
- Visual regression (スクリーンショット差分)
- 100% コードカバレッジ目標
- Linux / Windows での E2E 実行 (将来課題)
- Community Plugin Registry への自動申請

## License

This plugin's own source is under the project license (TBD). The bundled
draw.io webapp under `vendor/drawio/` retains its Apache-2.0 license; see
`dist/drawio/LICENSE` for the redistributed copy.
