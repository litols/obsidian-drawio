/**
 * iframe-init/request-manager
 *
 * In-iframe code — patches DOM prototype APIs and XMLHttpRequest so that all
 * relative resource URLs are resolved against a href→Blob-URL Map that is
 * populated incrementally as the parent streams asset chunks.
 *
 * OOM 対策 (要件 5.5, 5.6): アセットは親から `{action:"assets"}` チャンクで逐次届く。
 * `ingest()` は受信ごとに各エントリを即座に Blob URL へ変換し、**ソース文字列を保持しない**
 * (href→URL の Map のみ保持)。Blob は Chromium の blob storage 管理下に置かれ V8 ヒープを
 * 占有しないため、単一巨大 postMessage による renderer メモリスパイクを回避する。
 * 例外: CSP が `style-src blob:` を禁じるため text/css のみ `<style>` 注入用にテキストを保持する
 * (styles/ 群は数百 KB でありメモリ主因ではない)。
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
   * Blob-ize and register a batch of asset entries. Each entry's source string
   * is converted to a Blob URL immediately and then dropped (only href→URL is
   * kept). text/css entries additionally keep their decoded text for `<style>`
   * injection (CSP forbids blob: in style-src).
   */
  ingest(entries: readonly DrawioResponseEntry[]): void;
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
  /** href → blob/data URL. The only retained representation of heavy assets. */
  const urlMap = new Map<string, string>();
  /** href → decoded CSS text (text/css only; kept for `<style>` injection). */
  const cssText = new Map<string, string>();
  /** Links already turned into inline `<style>` (dedupe on repeated href set). */
  const styleInjected = new WeakSet<HTMLLinkElement>();

  let intercepted = false;

  function ingest(entries: readonly DrawioResponseEntry[]): void {
    for (const entry of entries) {
      // text/css: keep decoded text for <style> injection (CSP blocks blob: css).
      if (entry.mediaType.startsWith("text/css")) {
        const text = entry.mediaType.endsWith(";base64") ? atob(entry.source) : entry.source;
        cssText.set(entry.href, text);
      }
      urlMap.set(entry.href, blobifyEntry(entry));
      // entry.source is not retained beyond this loop iteration.
    }
  }

  /** Inline one stylesheet href as a <style> if we hold its CSS text. */
  function inlineStylesheet(link: HTMLLinkElement, href: string): boolean {
    const text = cssText.get(href);
    if (text === undefined) return false;
    if (!styleInjected.has(link)) {
      styleInjected.add(link);
      const styleEl = document.createElement("style");
      styleEl.textContent = rewriteCssUrlValue(text, urlMap);
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
      const css = rewriteCssUrlValue(text, urlMap);
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
        origLinkSetAttr.call(this, qualifiedName, resolveFromMap(value, urlMap));
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
          origLinkHrefSetter.call(this, resolveFromMap(value, urlMap));
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
        origScriptSetAttr.call(this, qualifiedName, resolveFromMap(value, urlMap));
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
          origScriptSrcSetter.call(this, resolveFromMap(value, urlMap));
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
        origImgSetAttr.call(this, qualifiedName, resolveFromMap(value, urlMap));
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
          origImgSrcSetter.call(this, resolveFromMap(value, urlMap));
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
                (target as any)[prop] = rewriteCssUrlValue(value, urlMap);
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
      const resolved = resolveFromMap(urlStr, urlMap);
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
    // Prototype restoration is NOT done — iframe is destroyed by parent.
  }

  return { interceptRequests, ingest, injectStylesheets, dispose };
};
