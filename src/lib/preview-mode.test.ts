// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { countDiagramPages, selectPreviewStrategy } from "./preview-mode";

const SINGLE_PAGE = "<mxfile><diagram>a</diagram></mxfile>";
const MULTI_PAGE = "<mxfile><diagram>a</diagram><diagram>b</diagram></mxfile>";
const BARE_MODEL = "<mxGraphModel><root/></mxGraphModel>";
const MALFORMED = "<mxfile><diagram></mxfile>";

describe("countDiagramPages", () => {
  it("単一 diagram → 1", () => {
    expect(countDiagramPages(SINGLE_PAGE)).toBe(1);
  });

  it("複数 diagram → 要素数を返す", () => {
    expect(countDiagramPages(MULTI_PAGE)).toBe(2);
  });

  it("diagram 要素なし (bare mxGraphModel) → 1", () => {
    expect(countDiagramPages(BARE_MODEL)).toBe(1);
  });

  it("空文字列 → 1", () => {
    expect(countDiagramPages("")).toBe(1);
    expect(countDiagramPages("   ")).toBe(1);
  });

  it("パース不能 (malformed XML) → 1", () => {
    expect(countDiagramPages(MALFORMED)).toBe(1);
  });
});

describe("selectPreviewStrategy", () => {
  it("svg 単一ページ → image", () => {
    expect(selectPreviewStrategy("drawio-svg", SINGLE_PAGE)).toBe("image");
  });

  it("png 単一ページ → image", () => {
    expect(selectPreviewStrategy("drawio-png", SINGLE_PAGE)).toBe("image");
  });

  it("svg 複数ページ → graph-viewer", () => {
    expect(selectPreviewStrategy("drawio-svg", MULTI_PAGE)).toBe("graph-viewer");
  });

  it("drawio (XML) → graph-viewer", () => {
    expect(selectPreviewStrategy("drawio", SINGLE_PAGE)).toBe("graph-viewer");
    expect(selectPreviewStrategy("drawio", MULTI_PAGE)).toBe("graph-viewer");
  });

  it("svg で diagram 要素なし → image (単一ページ扱い)", () => {
    expect(selectPreviewStrategy("drawio-svg", BARE_MODEL)).toBe("image");
  });
});
