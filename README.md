# obsidian-drawio

Obsidian desktop plugin for viewing and editing draw.io diagrams
(`.drawio`, `.drawio.svg`, `.drawio.png`) directly inside the Obsidian editor.

> **Status**: under active development. Spec-driven via the kiro workflow
> in `.kiro/specs/`.

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

## License

This plugin's own source is under the project license (TBD). The bundled
draw.io webapp under `vendor/drawio/` retains its Apache-2.0 license; see
`dist/drawio/LICENSE` for the redistributed copy.
