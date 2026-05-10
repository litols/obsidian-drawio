import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataAdapter } from "obsidian";

// obsidian はスタブ済 (vitest.config.ts の stub-obsidian プラグイン)
import {
  createDrawioAssetLoader,
  type DrawioAssetLoader,
} from "./drawio-asset-loader";

// ------- ヘルパ: DataAdapter のモック構築 -------

/** 再帰列挙をシミュレートするための仮想ファイルシステム */
type FakeFs = Record<
  string,
  | { type: "text"; content: string }
  | { type: "binary"; content: Uint8Array }
>;

function buildMockAdapter(
  fs: FakeFs,
): DataAdapter {
  // list は指定ディレクトリの直下エントリを返す (files / folders)
  const listImpl = vi.fn(async (path: string) => {
    const prefix = path.endsWith("/") ? path : path + "/";
    const files: string[] = [];
    const foldersSet = new Set<string>();

    for (const key of Object.keys(fs)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        files.push(key);
      } else {
        foldersSet.add(prefix + rest.slice(0, slashIdx));
      }
    }
    return { files, folders: [...foldersSet] };
  });

  const existsImpl = vi.fn(async (path: string) => {
    return Object.prototype.hasOwnProperty.call(fs, path);
  });

  const readBinaryImpl = vi.fn(async (path: string): Promise<ArrayBuffer> => {
    const entry = fs[path];
    if (!entry) throw new Error(`readBinary: not found: ${path}`);
    if (entry.type === "binary") return entry.content.buffer as ArrayBuffer;
    // テキストをバイナリとして返すケースも想定 (UTF-8 encode)
    return new TextEncoder().encode(entry.content).buffer as ArrayBuffer;
  });

  const readImpl = vi.fn(async (path: string): Promise<string> => {
    const entry = fs[path];
    if (!entry) throw new Error(`read: not found: ${path}`);
    if (entry.type === "text") return entry.content;
    return new TextDecoder().decode(entry.content);
  });

  return {
    getName: vi.fn(() => "mock"),
    exists: existsImpl,
    list: listImpl,
    read: readImpl,
    readBinary: readBinaryImpl,
    // 使わないメソッドは stub
    stat: vi.fn(),
    write: vi.fn(),
    writeBinary: vi.fn(),
    append: vi.fn(),
    process: vi.fn(),
    copy: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    trashSystem: vi.fn(),
    trashLocal: vi.fn(),
    rmdir: vi.fn(),
    remove: vi.fn(),
    getResourcePath: vi.fn(),
    getFullPath: vi.fn(),
  } as unknown as DataAdapter;
}

// ------- テスト用ファイルシステム -------

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DRAWIO_DIR = "plugins/my-plugin/drawio";

function makeFs(overrides: Partial<FakeFs> = {}): FakeFs {
  return {
    [`${DRAWIO_DIR}/index.html`]: {
      type: "text",
      content: "<html><body>index</body></html>",
    },
    [`${DRAWIO_DIR}/js/app.min.js`]: {
      type: "text",
      content: "// app.min.js source",
    },
    [`${DRAWIO_DIR}/styles/main.css`]: {
      type: "text",
      content: "body { margin: 0; }",
    },
    [`${DRAWIO_DIR}/images/logo.png`]: {
      type: "binary",
      content: PNG_BYTES,
    },
    ...overrides,
  };
}

// -----------------------------------------------

describe("createDrawioAssetLoader", () => {
  let loader: DrawioAssetLoader;

  beforeEach(() => {
    // 各テスト前にリセット
    loader = undefined as unknown as DrawioAssetLoader;
  });

  // ── 1. テキスト拡張子は UTF-8 文字列として responses に格納される ──
  it("テキスト拡張子 (.css) は UTF-8 文字列として responses に格納される", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    const cssEntry = bundle.responses.find((r) =>
      r.href.endsWith("styles/main.css"),
    );
    expect(cssEntry).toBeDefined();
    expect(cssEntry!.mediaType).toBe("text/css");
    // source は base64 でなくテキスト文字列
    expect(cssEntry!.source).toBe("body { margin: 0; }");
    // ';base64' サフィックスがないこと
    expect(cssEntry!.mediaType).not.toContain(";base64");
  });

  it("テキスト拡張子 (.js) は UTF-8 文字列として responses に格納される", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    const jsEntry = bundle.responses.find((r) =>
      r.href.endsWith("js/app.min.js"),
    );
    expect(jsEntry).toBeDefined();
    expect(jsEntry!.mediaType).toBe("text/javascript");
    expect(jsEntry!.source).toBe("// app.min.js source");
  });

  it("テキスト拡張子 (.html) は UTF-8 文字列として responses に格納される", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    const htmlEntry = bundle.responses.find((r) =>
      r.href.endsWith("index.html"),
    );
    expect(htmlEntry).toBeDefined();
    expect(htmlEntry!.mediaType).toBe("text/html");
    expect(htmlEntry!.source).toBe("<html><body>index</body></html>");
  });

  // ── 2. バイナリ拡張子は base64 文字列として responses に格納される ──
  it("バイナリ拡張子 (.png) は base64 文字列として responses に格納され、';base64' サフィックスが付く", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    const pngEntry = bundle.responses.find((r) =>
      r.href.endsWith("images/logo.png"),
    );
    expect(pngEntry).toBeDefined();
    expect(pngEntry!.mediaType).toBe("image/png;base64");
    // source は base64 文字列
    const expected = btoa(String.fromCharCode(...PNG_BYTES));
    expect(pngEntry!.source).toBe(expected);
  });

  // ── 3. indexHtml と appJsSource が正しく取得される ──
  it("indexHtml は index.html のテキスト内容である", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    expect(bundle.indexHtml).toBe("<html><body>index</body></html>");
  });

  it("appJsSource は app.min.js のテキスト内容である", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    expect(bundle.appJsSource).toBe("// app.min.js source");
  });

  // ── 4. エラーケース: index.html がない場合 ──
  it("index.html が存在しない場合、loadAll が throw する", async () => {
    const fs: FakeFs = {
      // index.html を除外
      [`${DRAWIO_DIR}/js/app.min.js`]: { type: "text", content: "// app" },
    };
    const adapter = buildMockAdapter(fs);
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    await expect(loader.loadAll()).rejects.toThrow();
  });

  // ── 5. エラーケース: app.min.js も app.js も存在しない場合 ──
  it("app.min.js も app.js も存在しない場合、loadAll が throw する", async () => {
    const fs: FakeFs = {
      [`${DRAWIO_DIR}/index.html`]: {
        type: "text",
        content: "<html></html>",
      },
      // js/ 配下に JS ファイルなし
    };
    const adapter = buildMockAdapter(fs);
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    await expect(loader.loadAll()).rejects.toThrow();
  });

  // ── 6. app.min.js が存在しないが app.js がある場合はそちらにフォールバック ──
  it("app.min.js がなく app.js がある場合は app.js を appJsSource として使用する", async () => {
    const fs: FakeFs = {
      [`${DRAWIO_DIR}/index.html`]: {
        type: "text",
        content: "<html></html>",
      },
      [`${DRAWIO_DIR}/js/app.js`]: {
        type: "text",
        content: "// app.js fallback",
      },
    };
    const adapter = buildMockAdapter(fs);
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    expect(bundle.appJsSource).toBe("// app.js fallback");
  });

  // ── 7. dispose 後に内部状態がクリアされる ──
  it("dispose 後に loadAll を呼ぶと throw する", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    // 1 度成功させてから dispose
    await loader.loadAll();
    loader.dispose();

    // dispose 後は loadAll が throw すること
    await expect(loader.loadAll()).rejects.toThrow();
  });

  // ── 8. href は drawioDir からの相対パスになっている ──
  it("responses の href は drawioDir からの相対パスである", async () => {
    const adapter = buildMockAdapter(makeFs());
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    for (const entry of bundle.responses) {
      // 絶対パス (drawioDir を含む) ではなく、相対パスであること
      expect(entry.href).not.toContain(DRAWIO_DIR);
    }
  });

  // ── 9. 複数の binary 拡張子のカバレッジ確認 ──
  it("gif, jpg, woff2 もバイナリ扱いで ;base64 サフィックスが付く", async () => {
    const fs: FakeFs = {
      ...makeFs(),
      [`${DRAWIO_DIR}/images/anim.gif`]: {
        type: "binary",
        content: new Uint8Array([0x47, 0x49, 0x46]),
      },
      [`${DRAWIO_DIR}/images/photo.jpg`]: {
        type: "binary",
        content: new Uint8Array([0xff, 0xd8, 0xff]),
      },
      [`${DRAWIO_DIR}/fonts/roboto.woff2`]: {
        type: "binary",
        content: new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
      },
    };
    const adapter = buildMockAdapter(fs);
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();

    const gif = bundle.responses.find((r) => r.href.endsWith(".gif"));
    const jpg = bundle.responses.find((r) => r.href.endsWith(".jpg"));
    const woff2 = bundle.responses.find((r) => r.href.endsWith(".woff2"));

    expect(gif?.mediaType).toBe("image/gif;base64");
    expect(jpg?.mediaType).toBe("image/jpeg;base64");
    expect(woff2?.mediaType).toBe("font/woff2;base64");
  });

  // ── 10. mjs / svg / xml 拡張子のカバレッジ ──
  it(".mjs は text/javascript として扱われる", async () => {
    const fs: FakeFs = {
      ...makeFs(),
      [`${DRAWIO_DIR}/js/worker.mjs`]: {
        type: "text",
        content: "// worker",
      },
    };
    const adapter = buildMockAdapter(fs);
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    const mjs = bundle.responses.find((r) => r.href.endsWith(".mjs"));
    expect(mjs?.mediaType).toBe("text/javascript");
  });

  it(".svg は image/svg+xml として扱われる", async () => {
    const fs: FakeFs = {
      ...makeFs(),
      [`${DRAWIO_DIR}/images/icon.svg`]: {
        type: "text",
        content: "<svg/>",
      },
    };
    const adapter = buildMockAdapter(fs);
    loader = createDrawioAssetLoader(adapter, DRAWIO_DIR);

    const bundle = await loader.loadAll();
    const svg = bundle.responses.find((r) => r.href.endsWith(".svg"));
    expect(svg?.mediaType).toBe("image/svg+xml");
  });
});
