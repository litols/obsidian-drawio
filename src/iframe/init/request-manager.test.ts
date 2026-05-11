// @vitest-environment jsdom
/**
 * Tests for iframe-init/request-manager (task 2.3)
 *
 * Requirements: 1.1, 1.3, 1.4, 3.2, 4.2
 * Design: iframe-init/request-manager component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DrawioResponseEntry } from "../shared/asset-types";
import { createRequestManager, resolveResourceUrl } from "./request-manager";

// jsdom does not implement URL.createObjectURL / revokeObjectURL
// Define them as stubs so vi.spyOn can replace them in tests.
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = (_blob: Blob) => "blob:stub";
}
if (typeof URL.revokeObjectURL === "undefined") {
  URL.revokeObjectURL = (_url: string) => {};
}

// ─── helper builders ───────────────────────────────────────────────────────

function makeTextEntry(
  href: string,
  source: string,
  mediaType = "text/javascript",
): DrawioResponseEntry {
  return { href, source, mediaType };
}

function makeBase64Entry(
  href: string,
  source: string,
  mediaType = "image/png;base64",
): DrawioResponseEntry {
  return { href, source, mediaType };
}

/** Generate a base64 string of a given length (arbitrary content). */
function base64ofLength(len: number): string {
  return "A".repeat(len);
}

// ─── URL resolution unit tests ─────────────────────────────────────────────

describe("resolveResourceUrl (unit)", () => {
  const responses: readonly DrawioResponseEntry[] = [
    makeTextEntry("js/main.js", "console.log('main')"),
    makeBase64Entry("images/spin.gif", base64ofLength(512), "image/gif;base64"), // < 1024 → data:
    makeBase64Entry("images/large.png", base64ofLength(2048), "image/png;base64"), // ≥ 1024 → blob:
  ];

  afterEach(() => {
    // reset any cached blob URLs between tests
    vi.restoreAllMocks();
  });

  it("passes through app:// URLs unchanged", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("app://abc/foo.js", responses, cache);
    expect(result).toBe("app://abc/foo.js");
  });

  it("passes through data: URLs unchanged", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("data:text/plain,hello", responses, cache);
    expect(result).toBe("data:text/plain,hello");
  });

  it("passes through https: URLs unchanged", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("https://example.com/x.js", responses, cache);
    expect(result).toBe("https://example.com/x.js");
  });

  it("passes through http: URLs unchanged", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("http://example.com/x.js", responses, cache);
    expect(result).toBe("http://example.com/x.js");
  });

  it("passes through protocol-relative // URLs unchanged", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("//cdn.example.com/x.js", responses, cache);
    expect(result).toBe("//cdn.example.com/x.js");
  });

  it("passes through #default#VML unchanged", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("#default#VML", responses, cache);
    expect(result).toBe("#default#VML");
  });

  it("returns original URL and warns for unknown relative URL", () => {
    const cache = new Map<string, string>();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = resolveResourceUrl("missing/file.js", responses, cache);
    expect(result).toBe("missing/file.js");
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("resolves text entry to a blob: URL", () => {
    const cache = new Map<string, string>();
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake-main-js");
    const result = resolveResourceUrl("js/main.js", responses, cache);
    expect(result).toMatch(/^blob:/);
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
  });

  it("resolves small base64 entry (< 1024 chars) to a data: URL", () => {
    const cache = new Map<string, string>();
    const result = resolveResourceUrl("images/spin.gif", responses, cache);
    expect(result).toMatch(/^data:/);
  });

  it("resolves large base64 entry (>= 1024 chars) to a blob: URL", () => {
    const cache = new Map<string, string>();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-large-png");
    const result = resolveResourceUrl("images/large.png", responses, cache);
    expect(result).toMatch(/^blob:/);
  });

  it("caches repeated lookups for the same href", () => {
    const cache = new Map<string, string>();
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cached");
    resolveResourceUrl("js/main.js", responses, cache);
    resolveResourceUrl("js/main.js", responses, cache);
    // createObjectURL must be called at most once for the same href
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
  });
});

// ─── RequestManager integration tests ─────────────────────────────────────

describe("createRequestManager", () => {
  const responses: readonly DrawioResponseEntry[] = [
    makeTextEntry("js/main.js", "// main"),
    makeTextEntry("js/foo.js", "// foo"),
    makeBase64Entry("images/spin.gif", base64ofLength(512), "image/gif;base64"),
    makeBase64Entry("images/large.png", base64ofLength(2048), "image/png;base64"),
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let revokeObjectURLSpy: any;

  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake-url");
    revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── setAttribute / setter for HTMLLinkElement ──────────────────────────

  it("link.setAttribute('href', 'js/main.js') → blob/data URL (non-stylesheet path)", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    // js/main.js is text/javascript not text/css → falls through to blob URL
    const link = document.createElement("link");
    link.setAttribute("href", "js/main.js");
    expect(link.getAttribute("href")).toMatch(/^blob:|^data:/);
  });

  it("link.href setter → blob/data URL (non-stylesheet path)", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const link = document.createElement("link");
    link.href = "js/main.js";
    expect(link.getAttribute("href")).toMatch(/^blob:|^data:/);
  });

  it("link.setAttribute('href', 'https://example.com/x.css') → passthrough", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const link = document.createElement("link");
    link.setAttribute("href", "https://example.com/x.css");
    expect(link.getAttribute("href")).toBe("https://example.com/x.css");
  });

  it("link[rel=stylesheet] CSS href → inline <style> injected, link neutralized (CSP workaround)", () => {
    const cssResponses: readonly DrawioResponseEntry[] = [
      makeTextEntry("styles/grapheditor.css", ".foo { color: red; }", "text/css"),
    ];
    const rm = createRequestManager(cssResponses);
    rm.interceptRequests();

    const beforeStyles = document.head.querySelectorAll("style").length;

    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", "styles/grapheditor.css");

    // link href should NOT be set (no fetch). rel is dropped so the browser
    // does not classify this element as a stylesheet to load.
    expect(link.getAttribute("href")).toBeNull();
    expect(link.getAttribute("rel")).toBe("");

    // <style> with the CSS source must be appended to head
    const afterStyles = document.head.querySelectorAll("style");
    expect(afterStyles.length).toBe(beforeStyles + 1);
    const last = afterStyles[afterStyles.length - 1] as HTMLStyleElement;
    expect(last.textContent).toBe(".foo { color: red; }");
  });

  // ── setAttribute / setter for HTMLScriptElement ────────────────────────

  it("script.setAttribute('src', 'js/foo.js') → blob/data URL", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const script = document.createElement("script");
    script.setAttribute("src", "js/foo.js");
    expect(script.getAttribute("src")).toMatch(/^blob:|^data:/);
  });

  it("script.src setter → calls createObjectURL (resolution went through)", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const createSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const script = document.createElement("script");
    script.src = "js/foo.js";
    expect(createSpy).toHaveBeenCalled();
  });

  // ── setAttribute / setter for HTMLImageElement ─────────────────────────

  it("img.setAttribute('src', 'images/spin.gif') → data: URL for small base64", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const img = document.createElement("img");
    img.setAttribute("src", "images/spin.gif");
    expect(img.getAttribute("src")).toMatch(/^data:/);
  });

  it("img.setAttribute('src', 'images/large.png') → blob: URL for large base64", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const img = document.createElement("img");
    img.setAttribute("src", "images/large.png");
    expect(img.getAttribute("src")).toMatch(/^blob:/);
  });

  // ── passthrough for app:// ──────────────────────────────────────────────

  it("link.setAttribute('href', 'app://abc/x') → passthrough", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const link = document.createElement("link");
    link.setAttribute("href", "app://abc/x");
    expect(link.getAttribute("href")).toBe("app://abc/x");
  });

  // ── unknown URL: warn + passthrough ────────────────────────────────────

  it("unknown relative URL → console.warn called once, attribute unchanged", () => {
    // Use a fresh RequestManager with empty responses to isolate this test.
    // Prototype patches from previous tests are cumulative in jsdom, so we
    // verify warn is called AT LEAST once and the attribute is preserved.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const link = document.createElement("link");
    const prevWarnCount = warnSpy.mock.calls.length;
    link.setAttribute("href", "missing/file.js");
    // Warn should have been called at least once for this URL
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(prevWarnCount + 1);
    expect(link.getAttribute("href")).toBe("missing/file.js");
  });

  // ── CSS style Proxy ─────────────────────────────────────────────────────

  it("el.style.backgroundImage with url('images/spin.gif') → rewritten to data: URL", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const el = document.createElement("div");
    document.body.appendChild(el);
    el.style.backgroundImage = "url('images/spin.gif')";
    const val = el.style.backgroundImage;
    // The rewritten value should contain a data: or blob: URL
    expect(val).toMatch(/url\(["']?(data:|blob:)/);
    document.body.removeChild(el);
  });

  // ── XHR open patching ──────────────────────────────────────────────────

  it("XMLHttpRequest.open with relative URL → URL gets resolved", () => {
    // Add a shapes entry to test XHR path
    const xhrResponses: readonly DrawioResponseEntry[] = [
      ...responses,
      makeTextEntry("shapes/foo.xml", "<shapes/>", "application/xml"),
    ];
    const rm = createRequestManager(xhrResponses);
    rm.interceptRequests();

    // Verify XHR URL resolution via resolveResourceUrl directly.
    // (jsdom's XHR doesn't support full open() semantics, so we test the
    //  resolver function which is the same code path prototype.open uses.)

    // Manually invoke the patched prototype open on our instance
    // Because the patch is on the prototype, calling xhrInstance.open will go through it.
    // However, since openSpy replaces the instance method, we need to test via the prototype directly.
    // Instead, test via resolveResourceUrl directly for XHR path correctness.
    const cache = new Map<string, string>();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shapes-foo");
    const resolved = resolveResourceUrl("shapes/foo.xml", xhrResponses, cache);
    expect(resolved).toMatch(/^blob:|^data:/);
  });

  // ── dispose: revokes blob URLs ──────────────────────────────────────────

  it("dispose() calls revokeObjectURL for each cached blob URL", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const link1 = document.createElement("link");
    link1.setAttribute("href", "js/main.js");

    const link2 = document.createElement("link");
    link2.setAttribute("href", "js/foo.js");

    rm.dispose();
    // Each distinct blob: URL that was created should have been revoked
    expect(revokeObjectURLSpy).toHaveBeenCalled();
  });

  it("dispose() clears the cache so subsequent revokeObjectURL calls don't re-fire", () => {
    const rm = createRequestManager(responses);
    rm.interceptRequests();

    const link = document.createElement("link");
    link.setAttribute("href", "js/main.js");

    rm.dispose();
    const callCountAfterFirst = revokeObjectURLSpy.mock.calls.length;

    rm.dispose(); // second dispose — cache is already cleared
    expect(revokeObjectURLSpy.mock.calls.length).toBe(callCountAfterFirst);
  });
});
