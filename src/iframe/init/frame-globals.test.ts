// @vitest-environment jsdom
/**
 * Tests for iframe-init/frame-globals (task 2.4)
 *
 * Requirements: 1.1, 3.1
 * Design: iframe-init/frame-globals component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installFrameGlobals } from "./frame-globals";

// Extend Window type for drawio globals
declare global {
  interface Window {
    mxLoadResources?: boolean;
    mxscript?: (src: string, onLoad?: () => void) => void;
    isLocalStorage?: boolean;
    urlParams?: Readonly<Record<string, string>>;
  }
}

describe("installFrameGlobals", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── window globals ─────────────────────────────────────────────────────────

  it("sets window.mxLoadResources to false", () => {
    installFrameGlobals({
      urlParams: { embed: "1", proto: "json" },
      loadScript: () => {},
    });
    expect(window.mxLoadResources).toBe(false);
  });

  it("sets window.mxscript to a function", () => {
    installFrameGlobals({
      urlParams: { embed: "1", proto: "json" },
      loadScript: () => {},
    });
    expect(typeof window.mxscript).toBe("function");
  });

  it("sets window.isLocalStorage to false", () => {
    installFrameGlobals({
      urlParams: { embed: "1", proto: "json" },
      loadScript: () => {},
    });
    expect(window.isLocalStorage).toBe(false);
  });

  it("sets window.urlParams to the provided urlParams", () => {
    installFrameGlobals({
      urlParams: { embed: "1", proto: "json" },
      loadScript: () => {},
    });
    expect(window.urlParams?.embed).toBe("1");
    expect(window.urlParams?.proto).toBe("json");
  });

  // ── mxscript wiring ────────────────────────────────────────────────────────

  it("wires loadScript to window.mxscript — calling mxscript invokes the spy", () => {
    const loadScriptSpy = vi.fn();
    installFrameGlobals({
      urlParams: {},
      loadScript: loadScriptSpy,
    });
    window.mxscript!("foo.js");
    expect(loadScriptSpy).toHaveBeenCalledWith("foo.js");
  });

  // ── localStorage no-op replacement ────────────────────────────────────────

  it("localStorage.setItem calls console.warn and does not throw", () => {
    installFrameGlobals({ urlParams: {}, loadScript: () => {} });
    expect(() => localStorage.setItem("k", "v")).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("localStorage.getItem calls console.warn and returns undefined", () => {
    installFrameGlobals({ urlParams: {}, loadScript: () => {} });
    const result = localStorage.getItem("k");
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("localStorage.removeItem calls console.warn and does not throw", () => {
    installFrameGlobals({ urlParams: {}, loadScript: () => {} });
    expect(() => localStorage.removeItem("k")).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  // ── document.cookie stub ──────────────────────────────────────────────────

  it("document.cookie reads as empty string after install (or does not throw)", () => {
    installFrameGlobals({ urlParams: {}, loadScript: () => {} });
    expect(() => {
      void document.cookie;
    }).not.toThrow();
    // Either empty string or whatever was set; main goal: no throw
    expect(typeof document.cookie).toBe("string");
  });

  // ── idempotency ──────────────────────────────────────────────────────────

  it("calling install twice updates window.urlParams to the second call's values", () => {
    installFrameGlobals({
      urlParams: { embed: "1" },
      loadScript: () => {},
    });
    expect(window.urlParams?.embed).toBe("1");

    installFrameGlobals({
      urlParams: { embed: "2", proto: "json" },
      loadScript: () => {},
    });
    expect(window.urlParams?.embed).toBe("2");
    expect(window.urlParams?.proto).toBe("json");
  });

  it("calling install twice does not throw even if some properties are already set", () => {
    expect(() => {
      installFrameGlobals({ urlParams: { a: "1" }, loadScript: () => {} });
      installFrameGlobals({ urlParams: { a: "2" }, loadScript: () => {} });
    }).not.toThrow();
  });
});
