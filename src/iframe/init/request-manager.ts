/**
 * iframe-init/request-manager
 *
 * In-iframe code — patches DOM prototype APIs and XMLHttpRequest so that all
 * relative resource URLs are resolved against a href→Blob-URL Map that is
 * populated incrementally as the parent streams asset chunks.
 *
 * OOM 対策 (要件 5.5, 5.6): アセットは親から `{action:"assets"}` チャンクで逐次届く。
 * コア群は `ingest("core")` で即座に Blob URL 化しソース文字列を破棄する (href→URL の Map のみ保持)。
 * テール群 (stencils/shapes 等の重量・低頻度アセット) は `ingest("tail")` で文字列のまま遅延保持し、
 * 初回アクセス時に Blob 化して直後に原ソースを破棄する。これにより未参照テールの Blob 先行実体化
 * による恒常 RSS 増加を避けつつ、単一巨大 postMessage による transient スパイクも回避する。
 * 例外: CSP が `style-src blob:` を禁じるため text/css (コア) のみ `<style>` 注入用にテキストを保持する。
 *
 * Allowed imports (in-iframe IIFE build):
 *   - ../shared/asset-types
 *   - Browser globals only (Blob, URL, Proxy, Reflect, XMLHttpRequest, DOM prototypes)
 *
 * Requirements: 1.1, 1.3, 1.4, 3.2, 4.2, 5.5, 5.6
 */

import type { DrawioResponseEntry } from "../shared/asset-types";

// ─── Public interfaces ───────────────────────────────────────────────────────

export interface RequestManager {
  /** Patches DOM prototype APIs and XHR to intercept resource requests. */
  interceptRequests(): void;
  /**
   * Register a batch of asset entries from a delivery chunk.
   * - `group: "core"` → Blob-ize immediately and drop the source (only href→URL
   *   is kept). text/css entries additionally keep their decoded text for
   *   `<style>` injection (CSP forbids blob: in style-src).
   * - `group: "tail"` → keep the source **lazily**; the entry is Blob-ized only
   *   on first access, then its source is dropped. This avoids materialising
   *   ~55MB of rarely-used tail assets (stencils/shapes/…) into blob storage
   *   for diagrams that never reference them (要件 5.5 の恒常 RSS 抑制)。
   */
  ingest(entries: readonly DrawioResponseEntry[], group: "core" | "tail"): void;
  /**
   * Pre-inject the stylesheets declared by drawio's index.html `<link
   * rel="stylesheet">` tags as inline `<style>` elements (with url(...)
   * rewritten to Blob URLs). Call after the core asset group is ingested.
   */
  injectStylesheets(indexHtml: string): void;
  /**
   * Best-effort: revokes all issued Blob URLs and clears the cache.
   * The iframe is destroyed by the parent at dispose time, so prototype
   * restoration is NOT attempted (design decision — see design.md risk section).
   */
  dispose(): void;
}

export type CreateRequestManager = () => RequestManager;

// ─── URL passthrough predicates ──────────────────────────────────────────────

/**
 * Returns true when the URL must be passed through without modification.
 */
function isPassthroughUrl(url: string): boolean {
  if (url.startsWith("app://")) return true;
  if (url.startsWith("data:")) return true;
  if (url.startsWith("blob:")) return true;
  if (/^https?:/.test(url)) return true;
  if (url.startsWith("//")) return true;
  if (url.startsWith("#")) return true;
  return false;
}

// ─── Blob-ization ─────────────────────────────────────────────────────────────

/**
 * Converts an asset entry to a URL string (Blob URL, or a small inline data URL
 * for tiny base64 entries) without retaining the source. Exported for testing.
 */
export function blobifyEntry(entry: DrawioResponseEntry): string {
  const isBase64 = entry.mediaType.endsWith(";base64");

  // Small base64 entries → inline data URL (no Blob allocation)
  if (isBase64 && entry.source.length < 1024) {
    const rawMime = entry.mediaType.replace(/;base64$/, "");
    return `data:${rawMime};base64,${entry.source}`;
  }

  let blob: Blob;
  if (isBase64) {
    const rawMime = entry.mediaType.replace(/;base64$/, "");
    const binaryStr = atob(entry.source);
    const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
    blob = new Blob([bytes], { type: rawMime });
  } else {
    blob = new Blob([entry.source], { type: entry.mediaType });
  }
  return URL.createObjectURL(blob);
}

/**
 * Resolves `url` against the href→URL map. Passthrough URLs return as-is;
 * unmatched URLs warn and pass through (graceful degradation until the asset
 * chunk carrying them arrives). Exported for testing.
 */
export function resolveFromMap(url: string, urlMap: Map<string, string>): string {
  if (isPassthroughUrl(url)) return url;
  const mapped = urlMap.get(url);
  if (mapped !== undefined) return mapped;
  console.warn("[drawio-frame] request-manager: unmatched URL:", url);
  return url;
}

// ─── CSS url(...) rewriting ───────────────────────────────────────────────────

/**
 * Rewrites any `url(...)` references inside a CSS property value string against
 * the href→URL map. Only the URL fragment is replaced; quotes are preserved.
 */
export function rewriteCssUrlValue(value: string, urlMap: Map<string, string>): string {
  return value.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, (_match, quote, rawUrl) => {
    const resolved = resolveFromMap(rawUrl.trim(), urlMap);
    return `url(${quote}${resolved}${quote})`;
  });
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export const createRequestManager: CreateRequestManager = (): RequestManager => {
  /** href → blob/data URL. Retained representation of core (and accessed tail) assets. */
  const urlMap = new Map<string, string>();
  /** href → tail entry kept lazily until first access (then Blob-ized + dropped). */
  const lazyEntries = new Map<string, DrawioResponseEntry>();
  /** href → decoded CSS text (text/css only; kept for `<style>` injection). */
  const cssText = new Map<string, string>();
  /** Links already turned into inline `<style>` (dedupe on repeated href set). */
  const styleInjected = new WeakSet<HTMLLinkElement>();

  let intercepted = false;

  function ingest(entries: readonly DrawioResponseEntry[], group: "core" | "tail"): void {
    for (const entry of entries) {
      if (group === "tail") {
        // 遅延保持: アクセスされるまで Blob 化しない (未使用テールの恒常 RSS 抑制)。
        lazyEntries.set(entry.href, entry);
        continue;
      }
      // core: 即時 Blob 化 (起動に必要)。text/css は <style> 注入用にテキストも保持。
      if (entry.mediaType.startsWith("text/css")) {
        const text = entry.mediaType.endsWith(";base64") ? atob(entry.source) : entry.source;
        cssText.set(entry.href, text);
      }
      urlMap.set(entry.href, blobifyEntry(entry));
      // entry.source is not retained beyond this loop iteration.
    }
  }

  /**
   * URL を解決する。urlMap ヒット → 返却。lazy(tail) ヒット → その場で Blob 化し
   * urlMap へ移して原ソースを破棄。未マッチ → warn + passthrough (テール到着前の劣化許容)。
   */
  function resolve(url: string): string {
    if (isPassthroughUrl(url)) return url;
    const mapped = urlMap.get(url);
    if (mapped !== undefined) return mapped;
    const lazy = lazyEntries.get(url);
    if (lazy !== undefined) {
      const blobUrl = blobifyEntry(lazy);
      urlMap.set(url, blobUrl);
      lazyEntries.delete(url); // materialize on demand → drop source
      return blobUrl;
    }
    console.warn("[drawio-frame] request-manager: unmatched URL:", url);
    return url;
  }

  /** CSS 値内の url(...) を lazy 対応の resolve で書き換える。 */
  function rewriteCss(value: string): string {
    return value.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, (_m, quote, rawUrl) => {
      return `url(${quote}${resolve(rawUrl.trim())}${quote})`;
    });
  }

  /** Inline one stylesheet href as a <style> if we hold its CSS text. */
  function inlineStylesheet(link: HTMLLinkElement, href: string): boolean {
    const text = cssText.get(href);
    if (text === undefined) return false;
    if (!styleInjected.has(link)) {
      styleInjected.add(link);
      const styleEl = document.createElement("style");
      styleEl.textContent = rewriteCss(text);
      document.head.appendChild(styleEl);
    }
    return true;
  }

  function injectStylesheets(indexHtml: string): void {
    if (typeof indexHtml !== "string" || indexHtml.length === 0) return;
    const doc = new DOMParser().parseFromString(indexHtml, "text/html");
    const links = Array.from(doc.querySelectorAll("link[rel='stylesheet']"));
    for (const link of links) {
      const href = link.getAttribute("href");
      if (!href) continue;
      const text = cssText.get(href);
      if (text === undefined) continue;
      const media = link.getAttribute("media");
      const css = rewriteCss(text);
      const styleEl = document.createElement("style");
      styleEl.dataset["drawioInjected"] = href;
      styleEl.textContent = media ? `@media ${media} {\n${css}\n}` : css;
      document.head.appendChild(styleEl);
    }
  }

  function interceptRequests(): void {
    if (intercepted) return;
    intercepted = true;

    // ── HTMLLinkElement: setAttribute("href", ...) ────────────────────────
    const origLinkSetAttr = HTMLLinkElement.prototype.setAttribute;
    HTMLLinkElement.prototype.setAttribute = function (qualifiedName: string, value: string): void {
      if (qualifiedName === "href") {
        const rel = this.rel || this.getAttribute("rel");
        if ((rel === "stylesheet" || rel === null) && inlineStylesheet(this, value)) {
          origLinkSetAttr.call(this, "rel", "");
          return;
        }
        origLinkSetAttr.call(this, qualifiedName, resolve(value));
      } else {
        origLinkSetAttr.call(this, qualifiedName, value);
      }
    };

    // ── HTMLLinkElement: href property setter ─────────────────────────────
    const linkHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "href");
    if (linkHrefDescriptor?.set) {
      const origLinkHrefSetter = linkHrefDescriptor.set;
      Object.defineProperty(HTMLLinkElement.prototype, "href", {
        ...linkHrefDescriptor,
        set(value: string) {
          const rel = this.rel || this.getAttribute("rel");
          if ((rel === "stylesheet" || rel === null) && inlineStylesheet(this, value)) {
            this.rel = "";
            return;
          }
          origLinkHrefSetter.call(this, resolve(value));
        },
      });
    }

    // ── HTMLScriptElement: setAttribute("src", ...) ───────────────────────
    const origScriptSetAttr = HTMLScriptElement.prototype.setAttribute;
    HTMLScriptElement.prototype.setAttribute = function (
      qualifiedName: string,
      value: string,
    ): void {
      if (qualifiedName === "src") {
        origScriptSetAttr.call(this, qualifiedName, resolve(value));
      } else {
        origScriptSetAttr.call(this, qualifiedName, value);
      }
    };

    // ── HTMLScriptElement: src property setter ────────────────────────────
    const scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, "src");
    if (scriptSrcDescriptor?.set) {
      const origScriptSrcSetter = scriptSrcDescriptor.set;
      Object.defineProperty(HTMLScriptElement.prototype, "src", {
        ...scriptSrcDescriptor,
        set(value: string) {
          origScriptSrcSetter.call(this, resolve(value));
        },
      });
    }

    // ── HTMLImageElement: setAttribute("src", ...) ────────────────────────
    const origImgSetAttr = HTMLImageElement.prototype.setAttribute;
    HTMLImageElement.prototype.setAttribute = function (
      qualifiedName: string,
      value: string,
    ): void {
      if (qualifiedName === "src") {
        origImgSetAttr.call(this, qualifiedName, resolve(value));
      } else {
        origImgSetAttr.call(this, qualifiedName, value);
      }
    };

    // ── HTMLImageElement: src property setter ─────────────────────────────
    const imgSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    if (imgSrcDescriptor?.set) {
      const origImgSrcSetter = imgSrcDescriptor.set;
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        ...imgSrcDescriptor,
        set(value: string) {
          origImgSrcSetter.call(this, resolve(value));
        },
      });
    }

    // ── HTMLElement.prototype.style → Proxy for CSS url(...) rewriting ─────
    const styleDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "style");
    if (styleDescriptor?.get) {
      const origStyleGetter = styleDescriptor.get;
      Object.defineProperty(HTMLElement.prototype, "style", {
        ...styleDescriptor,
        get(this: HTMLElement): CSSStyleDeclaration {
          const realStyle: CSSStyleDeclaration = origStyleGetter.call(this);
          return new Proxy(realStyle, {
            get(target, prop) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const value = (target as any)[prop];
              if (typeof value === "function") {
                return value.bind(target);
              }
              return value;
            },
            set(target, prop, value) {
              if (typeof value === "string" && value.includes("url(")) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (target as any)[prop] = rewriteCss(value);
                return true;
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (target as any)[prop] = value;
              return true;
            },
          });
        },
      });
    }

    // ── XMLHttpRequest.prototype.open ─────────────────────────────────────
    const origXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      const urlStr = typeof url === "string" ? url : url.toString();
      const resolved = resolve(urlStr);
      origXhrOpen.call(this, method, resolved, async ?? true, username ?? null, password ?? null);
    };
  }

  function dispose(): void {
    for (const blobUrl of urlMap.values()) {
      if (blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(blobUrl);
      }
    }
    urlMap.clear();
    cssText.clear();
    lazyEntries.clear();
    // Prototype restoration is NOT done — iframe is destroyed by parent.
  }

  return { interceptRequests, ingest, injectStylesheets, dispose };
};
