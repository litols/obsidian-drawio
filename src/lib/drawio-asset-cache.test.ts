import { describe, it, expect, vi } from "vitest";
import type { DataAdapter } from "obsidian";
import { createDrawioAssetCache } from "./drawio-asset-cache";

const PLUGIN_DIR = "plugins/my-plugin";
const DRAWIO_DIR = `${PLUGIN_DIR}/drawio`;

type FakeFs = Record<string, string>;

function baseFs(): FakeFs {
  return {
    [`${DRAWIO_DIR}/index.html`]: "<html>index</html>",
    [`${DRAWIO_DIR}/js/app.min.js`]: "// app",
    [`${DRAWIO_DIR}/js/viewer-static.min.js`]: "// viewer-static",
    [`${DRAWIO_DIR}/styles/main.css`]: "body{}",
  };
}

/** list / exists / read を fs から供給するモック。呼び出し回数は vi.fn で観測可能 */
function buildAdapter(getFs: () => FakeFs) {
  const list = vi.fn(async (path: string) => {
    const fs = getFs();
    const prefix = path.endsWith("/") ? path : path + "/";
    const files: string[] = [];
    const folders = new Set<string>();
    for (const key of Object.keys(fs)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) files.push(key);
      else folders.add(prefix + rest.slice(0, slash));
    }
    return { files, folders: [...folders] };
  });
  const exists = vi.fn(async (path: string) => Object.prototype.hasOwnProperty.call(getFs(), path));
  const read = vi.fn(async (path: string) => {
    const fs = getFs();
    if (!Object.prototype.hasOwnProperty.call(fs, path)) throw new Error(`read: ${path}`);
    return fs[path];
  });
  const readBinary = vi.fn(async () => new ArrayBuffer(0));
  const adapter = {
    getName: () => "mock",
    list,
    exists,
    read,
    readBinary,
  } as unknown as DataAdapter;
  return { adapter, list, exists, read };
}

describe("createDrawioAssetCache", () => {
  it("loadAll は除外マニフェスト適用済みのバンドルを返す", async () => {
    const fs = {
      ...baseFs(),
      [`${DRAWIO_DIR}/js/integrate.min.js`]: "// integrate",
    };
    const { adapter } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    const bundle = await cache.loadAll();
    const hrefs = bundle.responses.map((r) => r.href);
    // viewer-static / integrate は EDITOR_ASSET_EXCLUDES で除外される
    expect(hrefs).not.toContain("js/viewer-static.min.js");
    expect(hrefs).not.toContain("js/integrate.min.js");
    expect(hrefs).toContain("js/app.min.js");
  });

  it("single-flight: 並行 2 呼び出しでディスク列挙は 1 回のみ", async () => {
    const fs = baseFs();
    const { adapter, list } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    const [a, b] = await Promise.all([cache.loadAll(), cache.loadAll()]);
    // 同一 Promise を共有するので同じバンドル参照
    expect(a).toBe(b);
    // ルート列挙 (adapter.list) は 1 回だけ (2 回目のマウントはメモから供給)
    const rootListCalls = list.mock.calls.filter((c) => c[0] === DRAWIO_DIR).length;
    expect(rootListCalls).toBe(1);
  });

  it("2 回目 loadAll はディスク再読込せずメモから返す", async () => {
    const fs = baseFs();
    const { adapter, list } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    await cache.loadAll();
    const listCallsAfterFirst = list.mock.calls.length;
    await cache.loadAll();
    expect(list.mock.calls.length).toBe(listCallsAfterFirst);
  });

  it("ロード失敗時はメモを破棄し次回リトライできる", async () => {
    // 最初は index.html が無く loadAll が reject → 後で追加してリトライ成功
    let fs: FakeFs = {
      [`${DRAWIO_DIR}/js/app.min.js`]: "// app",
    };
    const { adapter } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    await expect(cache.loadAll()).rejects.toThrow();

    fs = baseFs();
    const bundle = await cache.loadAll();
    expect(bundle.indexHtml).toBe("<html>index</html>");
  });

  it("getViewerScript は viewer-static.min.js を返し single-flight", async () => {
    const fs = baseFs();
    const { adapter, read } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    const [s1, s2] = await Promise.all([cache.getViewerScript(), cache.getViewerScript()]);
    expect(s1).toBe("// viewer-static");
    expect(s2).toBe("// viewer-static");
    const viewerReads = read.mock.calls.filter(
      (c) => c[0] === `${DRAWIO_DIR}/js/viewer-static.min.js`,
    ).length;
    expect(viewerReads).toBe(1);
  });

  it("getViewerScript 失敗時はメモを破棄し次回リトライできる", async () => {
    let fs: FakeFs = { [`${DRAWIO_DIR}/index.html`]: "x" }; // viewer なし
    const { adapter } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    await expect(cache.getViewerScript()).rejects.toThrow();
    fs = baseFs();
    await expect(cache.getViewerScript()).resolves.toBe("// viewer-static");
  });

  it("dispose 後の loadAll は再ロードで応える (例外にしない)", async () => {
    const fs = baseFs();
    const { adapter, list } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    await cache.loadAll();
    const listCallsBefore = list.mock.calls.length;
    cache.dispose();
    // dispose 後はメモが破棄され再ロードされる
    const bundle = await cache.loadAll();
    expect(bundle.indexHtml).toBe("<html>index</html>");
    expect(list.mock.calls.length).toBeGreaterThan(listCallsBefore);
  });

  it("invalidate 後は次回 loadAll で再ロードする", async () => {
    const fs = baseFs();
    const { adapter, list } = buildAdapter(() => fs);
    const cache = createDrawioAssetCache(adapter, PLUGIN_DIR);

    await cache.loadAll();
    const before = list.mock.calls.length;
    cache.invalidate();
    await cache.loadAll();
    expect(list.mock.calls.length).toBeGreaterThan(before);
  });
});
