// @vitest-environment jsdom
/**
 * Tests for iframe-init/request-manager (chunked ingest + Blob-ization).
 *
 * Requirements: 1.1, 1.3, 1.4, 3.2, 4.2, 5.5, 5.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DrawioResponseEntry } from "../shared/asset-types";
import {
  createRequestManager,
  resolveFromMap,
  rewriteCssUrlValue,
  blobifyEntry,
} from "./request-manager";

// jsdom does not implement URL.createObjectURL / revokeObjectURL.
if (typeof URL.createObjectURL === "undefined") {
  URL.createObjectURL = (_blob: Blob) => "blob:stub";
}
if (typeof URL.revokeObjectURL === "undefined") {
  URL.revokeObjectURL = (_url: string) => {};
}

function textEntry(
  href: string,
  source: string,
  mediaType = "text/javascript",
): DrawioResponseEntry {
  return { href, source, mediaType };
}
function b64Entry(
  href: string,
  source: string,
  mediaType = "image/png;base64",
): DrawioResponseEntry {
  return { href, source, mediaType };
}

let blobCounter = 0;
beforeEach(() => {
  blobCounter = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:obj-${blobCounter++}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("blobifyEntry", () => {
  it("text エントリは blob: URL を返す", () => {
    expect(blobifyEntry(textEntry("js/a.js", "x"))).toMatch(/^blob:/);
  });

  it("小さい base64 (<1024) は inline data: URL を返す (Blob 割当なし)", () => {
    const url = blobifyEntry(b64Entry("img/s.gif", "A".repeat(512), "image/gif;base64"));
    expect(url.startsWith("data:image/gif;base64,")).toBe(true);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("大きい base64 (>=1024) は blob: URL を返す", () => {
    const url = blobifyEntry(b64Entry("img/l.png", "QUJD".repeat(400), "image/png;base64"));
    expect(url).toMatch(/^blob:/);
  });
});

describe("resolveFromMap", () => {
  const map = new Map<string, string>([["js/main.js", "blob:mapped"]]);

  it.each(["app://x", "data:foo", "blob:existing", "https://x", "http://x", "//cdn/x", "#frag"])(
    "passthrough: %s",
    (u) => {
      expect(resolveFromMap(u, map)).toBe(u);
    },
  );

  it("マップヒットは対応 URL を返す", () => {
    expect(resolveFromMap("js/main.js", map)).toBe("blob:mapped");
  });

  it("未マッチは warn + 原 URL を passthrough", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveFromMap("js/missing.js", map)).toBe("js/missing.js");
    expect(warn).toHaveBeenCalled();
  });
});

describe("rewriteCssUrlValue", () => {
  it("url(...) をマップの blob URL に書き換え、引用符を保持する", () => {
    const map = new Map<string, string>([["img/bg.png", "blob:bg"]]);
    expect(rewriteCssUrlValue("background:url('img/bg.png')", map)).toBe(
      "background:url('blob:bg')",
    );
    expect(rewriteCssUrlValue("background:url(img/bg.png)", map)).toBe("background:url(blob:bg)");
  });
});

describe("createRequestManager: ingest + 解決", () => {
  it("ingest でソースを Blob 化し、interceptRequests 後に script.src が blob へ解決される", () => {
    const mgr = createRequestManager();
    mgr.ingest([textEntry("js/foo.js", "console.log(1)")], "core");
    mgr.interceptRequests();

    const script = document.createElement("script");
    script.setAttribute("src", "js/foo.js");
    expect(script.getAttribute("src")).toMatch(/^blob:/);
    mgr.dispose();
  });

  it("img.src / XHR open もマップ経由で解決される", () => {
    const mgr = createRequestManager();
    mgr.ingest([b64Entry("img/l.png", "QUJD".repeat(400), "image/png;base64")], "core");
    mgr.interceptRequests();

    const img = document.createElement("img");
    img.setAttribute("src", "img/l.png");
    expect(img.getAttribute("src")).toMatch(/^blob:/);

    const xhr = new XMLHttpRequest();
    // open は例外なく実行できればよい (jsdom で blob: は送信されない)
    expect(() => xhr.open("GET", "img/l.png")).not.toThrow();
    mgr.dispose();
  });

  it("未 ingest の URL は warn + passthrough で劣化する (テール到着前アクセス)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mgr = createRequestManager();
    mgr.interceptRequests();
    const script = document.createElement("script");
    script.setAttribute("src", "stencils/aws.xml");
    expect(script.getAttribute("src")).toBe("stencils/aws.xml");
    expect(warn).toHaveBeenCalled();
    mgr.dispose();
  });

  it("dispose で発行した blob URL が revoke される", () => {
    const mgr = createRequestManager();
    mgr.ingest([textEntry("js/a.js", "x"), textEntry("js/b.js", "y")], "core");
    mgr.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe("createRequestManager: tail の遅延 Blob 化 (7.1b)", () => {
  it("tail はアクセスされるまで Blob 化されない", () => {
    const mgr = createRequestManager();
    mgr.ingest([textEntry("stencils/aws.js", "console.log('aws')")], "tail");
    mgr.interceptRequests();
    // まだアクセスしていないので Blob は作られていない
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    mgr.dispose();
  });

  it("tail は初回アクセス時に Blob 化され、2 回目はキャッシュ再利用 (ソース破棄)", () => {
    const mgr = createRequestManager();
    mgr.ingest([textEntry("stencils/aws.js", "console.log('aws')")], "tail");
    mgr.interceptRequests();

    const s1 = document.createElement("script");
    s1.setAttribute("src", "stencils/aws.js");
    expect(s1.getAttribute("src")).toMatch(/^blob:/);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    // 2 回目のアクセスは urlMap ヒットで新規 Blob を作らない (ソースは破棄済み)
    const s2 = document.createElement("script");
    s2.setAttribute("src", "stencils/aws.js");
    expect(s2.getAttribute("src")).toBe(s1.getAttribute("src"));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });

  it("tail は core と共存し、core は即時 Blob 化される", () => {
    const mgr = createRequestManager();
    mgr.ingest([textEntry("js/core.js", "x")], "core");
    // core ingest 時点で 1 つ Blob 化済み
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    mgr.ingest([textEntry("shapes/mockup.js", "y")], "tail");
    // tail は未アクセスなので増えない
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    mgr.dispose();
  });
});

describe("createRequestManager: CSS <style> 注入", () => {
  const INDEX_HTML =
    "<html><head>" +
    '<link rel="stylesheet" href="styles/main.css">' +
    '<link rel="stylesheet" href="styles/hc.css" media="(forced-colors: active)">' +
    "</head></html>";

  it("injectStylesheets は index.html の link を <style> として注入し media を尊重する", () => {
    const mgr = createRequestManager();
    mgr.ingest(
      [
        textEntry("styles/main.css", "body{background:url('img/bg.png')}", "text/css"),
        textEntry("styles/hc.css", "body{color:red}", "text/css"),
        b64Entry("img/bg.png", "QUJD".repeat(400), "image/png;base64"),
      ],
      "core",
    );
    mgr.interceptRequests();
    mgr.injectStylesheets(INDEX_HTML);

    const styles = Array.from(document.head.querySelectorAll("style[data-drawio-injected]"));
    expect(styles.length).toBe(2);
    const main = styles.find((s) => s.getAttribute("data-drawio-injected") === "styles/main.css")!;
    // url() が blob へ書き換わっている
    expect(main.textContent).toMatch(/url\('blob:/);
    const hc = styles.find((s) => s.getAttribute("data-drawio-injected") === "styles/hc.css")!;
    expect(hc.textContent).toContain("@media (forced-colors: active)");
    mgr.dispose();
  });

  it("動的 link.setAttribute('href') も CSS を <style> 化し fetch を無効化する", () => {
    const mgr = createRequestManager();
    mgr.ingest([textEntry("styles/x.css", "body{margin:0}", "text/css")], "core");
    mgr.interceptRequests();

    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    const before = document.head.querySelectorAll("style").length;
    link.setAttribute("href", "styles/x.css");
    expect(document.head.querySelectorAll("style").length).toBe(before + 1);
    // rel が落ちて fetch されない
    expect(link.getAttribute("rel")).toBe("");
    mgr.dispose();
  });
});
