/**
 * iframe-init/request-manager (task 2.3)
 *
 * In-iframe code — patches DOM prototype APIs and XMLHttpRequest so that all
 * relative resource URLs are resolved against the Responses table supplied by
 * the parent via {action:"configure"}.
 *
 * Allowed imports (in-iframe IIFE build):
 *   - ../shared/asset-types
 *   - Browser globals only (Blob, URL, Proxy, Reflect, XMLHttpRequest, DOM prototypes)
 *
 * Requirements: 1.1, 1.3, 1.4, 3.2, 4.2
 * Design: iframe-init/request-manager component
 */

import type { DrawioResponseEntry } from "../shared/asset-types";

// ─── Public interfaces ───────────────────────────────────────────────────────

export interface RequestManager {
  /** Patches DOM prototype APIs and XHR to intercept resource requests. */
  interceptRequests(): void;
  /**
   * Best-effort: revokes all issued Blob URLs and clears the cache.
   * The iframe is destroyed by the parent at dispose time, so prototype
   * restoration is NOT attempted (design decision — see design.md risk section).
   */
  dispose(): void;
}

export type CreateRequestManager = (
  responses: readonly DrawioResponseEntry[]
) => RequestManager;

// ─── URL passthrough predicates ──────────────────────────────────────────────

/**
 * Returns true when the URL must be passed through without modification.
 * Passthrough rules (design section "URL 判定"):
 *   - app://
 *   - data:
 *   - https?: or http:
 *   - protocol-relative //
 *   - #default#VML (and # fragments in general)
 */
function isPassthroughUrl(url: string): boolean {
  if (url.startsWith("app://")) return true;
  if (url.startsWith("data:")) return true;
  if (/^https?:/.test(url)) return true;
  if (url.startsWith("//")) return true;
  if (url.startsWith("#")) return true;
  return false;
}

// ─── Blob URL resolution ─────────────────────────────────────────────────────

/**
 * Resolves `url` against `responses`.
 *
 * Resolution rules:
 *   1. Passthrough URLs → return as-is.
 *   2. Cache hit → return cached Blob/data URL.
 *   3. Responses match found:
 *      - If mediaType ends with ";base64" AND source.length < 1024 →
 *        return inline data URL (no Blob allocation).
 *      - Otherwise create Blob (decoding base64 if necessary) and return
 *        URL.createObjectURL result; cache it.
 *   4. No match → console.warn, return original URL.
 *
 * Exported for unit-testing of the resolution logic independently of
 * the prototype patches.
 */
export function resolveResourceUrl(
  url: string,
  responses: readonly DrawioResponseEntry[],
  cache: Map<string, string>,
): string {
  if (isPassthroughUrl(url)) return url;

  // Cache hit
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  // Responses table lookup
  const entry = responses.find((r) => r.href === url);
  if (entry === undefined) {
    console.warn("[drawio-frame] request-manager: unmatched URL:", url);
    return url;
  }

  const isBase64 = entry.mediaType.endsWith(";base64");

  // Small base64 entries → inline data URL (no Blob allocation)
  if (isBase64 && entry.source.length < 1024) {
    const rawMime = entry.mediaType.replace(/;base64$/, "");
    const dataUrl = `data:${rawMime};base64,${entry.source}`;
    cache.set(url, dataUrl);
    return dataUrl;
  }

  // Text or large base64 → Blob URL
  let blob: Blob;
  if (isBase64) {
    const rawMime = entry.mediaType.replace(/;base64$/, "");
    const binaryStr = atob(entry.source);
    const bytes = Uint8Array.from(binaryStr, (c) => c.charCodeAt(0));
    blob = new Blob([bytes], { type: rawMime });
  } else {
    blob = new Blob([entry.source], { type: entry.mediaType });
  }

  const blobUrl = URL.createObjectURL(blob);
  cache.set(url, blobUrl);
  return blobUrl;
}

// ─── CSS url(...) rewriting ───────────────────────────────────────────────────

/**
 * Rewrites any `url(...)` references inside a CSS property value string.
 * Only the URL fragment is replaced; surrounding quotes are preserved.
 */
function rewriteCssUrlValue(
  value: string,
  responses: readonly DrawioResponseEntry[],
  cache: Map<string, string>,
): string {
  // Match url("..."), url('...'), url(...)
  return value.replace(
    /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g,
    (_match, quote, rawUrl) => {
      const resolved = resolveResourceUrl(rawUrl.trim(), responses, cache);
      return `url(${quote}${resolved}${quote})`;
    },
  );
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Creates a RequestManager for the given Responses table.
 *
 * Calling `interceptRequests()` twice is a no-op (idempotent guard via flag).
 */
export const createRequestManager: CreateRequestManager = (
  responses: readonly DrawioResponseEntry[],
): RequestManager => {
  /** Shared Blob URL cache: href → blob/data URL */
  const cache = new Map<string, string>();

  let intercepted = false;

  // Saved original setAttribute references
  let _origLinkSetAttr: typeof HTMLLinkElement.prototype.setAttribute | null = null;
  let _origScriptSetAttr: typeof HTMLScriptElement.prototype.setAttribute | null = null;
  let _origImgSetAttr: typeof HTMLImageElement.prototype.setAttribute | null = null;
  let _origXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;

  // ── interceptRequests ────────────────────────────────────────────────────

  function interceptRequests(): void {
    if (intercepted) {
      // Idempotency: no-op on second call
      return;
    }
    intercepted = true;

    // ── HTMLLinkElement: setAttribute("href", ...) ────────────────────────
    _origLinkSetAttr = HTMLLinkElement.prototype.setAttribute;
    const origLinkSetAttr = _origLinkSetAttr;
    HTMLLinkElement.prototype.setAttribute = function (
      qualifiedName: string,
      value: string,
    ): void {
      if (qualifiedName === "href") {
        origLinkSetAttr.call(this, qualifiedName, resolveResourceUrl(value, responses, cache));
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
          origLinkHrefSetter.call(this, resolveResourceUrl(value, responses, cache));
        },
      });
    }

    // ── HTMLScriptElement: setAttribute("src", ...) ───────────────────────
    _origScriptSetAttr = HTMLScriptElement.prototype.setAttribute;
    const origScriptSetAttr = _origScriptSetAttr;
    HTMLScriptElement.prototype.setAttribute = function (
      qualifiedName: string,
      value: string,
    ): void {
      if (qualifiedName === "src") {
        origScriptSetAttr.call(this, qualifiedName, resolveResourceUrl(value, responses, cache));
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
          origScriptSrcSetter.call(this, resolveResourceUrl(value, responses, cache));
        },
      });
    }

    // ── HTMLImageElement: setAttribute("src", ...) ────────────────────────
    _origImgSetAttr = HTMLImageElement.prototype.setAttribute;
    const origImgSetAttr = _origImgSetAttr;
    HTMLImageElement.prototype.setAttribute = function (
      qualifiedName: string,
      value: string,
    ): void {
      if (qualifiedName === "src") {
        origImgSetAttr.call(this, qualifiedName, resolveResourceUrl(value, responses, cache));
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
          origImgSrcSetter.call(this, resolveResourceUrl(value, responses, cache));
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
            set(target, prop, value) {
              if (typeof value === "string" && value.includes("url(")) {
                const rewritten = rewriteCssUrlValue(value, responses, cache);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (target as any)[prop] = rewritten;
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
    _origXhrOpen = XMLHttpRequest.prototype.open;
    const origXhrOpen = _origXhrOpen;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ): void {
      const urlStr = typeof url === "string" ? url : url.toString();
      const resolved = resolveResourceUrl(urlStr, responses, cache);
      // Forward with all original arguments, substituting the resolved URL.
      // XMLHttpRequest.open signature requires at minimum 3 arguments in strict mode.
      origXhrOpen.call(this, method, resolved, async ?? true, username ?? null, password ?? null);
    };
  }

  // ── dispose ─────────────────────────────────────────────────────────────

  function dispose(): void {
    // Revoke all issued Blob URLs
    for (const blobUrl of cache.values()) {
      if (blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(blobUrl);
      }
    }
    cache.clear();
    // Prototype restoration is NOT done — iframe is destroyed by parent.
    // (Design: "best-effort restore of patched prototypes is NOT required")
  }

  return { interceptRequests, dispose };
};
