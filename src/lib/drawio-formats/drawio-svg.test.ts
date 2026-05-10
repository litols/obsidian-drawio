// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readDrawioSvg, writeDrawioSvgWithMxfile } from "./drawio-svg";

const MXFILE = "<mxfile><diagram>test-content</diagram></mxfile>";
const MXFILE2 = "<mxfile><diagram>updated-content</diagram></mxfile>";
const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvgWithContentAttr(mxfileXml: string): string {
  const b64 = btoa(mxfileXml);
  return `<svg xmlns="${SVG_NS}" width="100" height="100" content="${b64}"></svg>`;
}

function makeSvgWithMxfileChild(mxfileXml: string): string {
  return `<svg xmlns="${SVG_NS}" width="100" height="100">${mxfileXml}</svg>`;
}

function makeBaresvg(): string {
  return `<svg xmlns="${SVG_NS}" width="100" height="100"></svg>`;
}

describe("readDrawioSvg", () => {
  describe("content attribute path", () => {
    it("decodes base64 mxfile from content attribute", () => {
      const svg = makeSvgWithContentAttr(MXFILE);
      expect(readDrawioSvg(svg)).toBe(MXFILE);
    });

    it("falls through to mxfile child when content attr is invalid base64", () => {
      const svg = `<svg xmlns="${SVG_NS}" content="!!!invalid!!!"><mxfile><diagram>child</diagram></mxfile></svg>`;
      const result = readDrawioSvg(svg);
      expect(result).toContain("mxfile");
      expect(result).toContain("child");
    });

    it("returns mxGraphModel/ when content attr is invalid and no mxfile child", () => {
      const svg = `<svg xmlns="${SVG_NS}" content="!!!invalid!!!"></svg>`;
      expect(readDrawioSvg(svg)).toBe("<mxGraphModel/>");
    });
  });

  describe("mxfile child element path", () => {
    it("serializes mxfile child element to string", () => {
      const svg = makeSvgWithMxfileChild(MXFILE);
      const result = readDrawioSvg(svg);
      expect(result).toContain("mxfile");
      expect(result).toContain("test-content");
    });
  });

  describe("fallback", () => {
    it("returns mxGraphModel/ for SVG with no content attr or mxfile child", () => {
      expect(readDrawioSvg(makeBaresvg())).toBe("<mxGraphModel/>");
    });

    it("returns mxGraphModel/ for empty string", () => {
      expect(readDrawioSvg("")).toBe("<mxGraphModel/>");
    });

    it("returns mxGraphModel/ when no svg root element", () => {
      expect(readDrawioSvg("<div>not svg</div>")).toBe("<mxGraphModel/>");
    });
  });
});

describe("writeDrawioSvgWithMxfile", () => {
  describe("content attribute path", () => {
    it("updates content attribute when svg already has content attr", () => {
      const original = makeSvgWithContentAttr(MXFILE);
      const written = writeDrawioSvgWithMxfile(original, MXFILE2);
      expect(readDrawioSvg(written)).toBe(MXFILE2);
    });

    it("no duplicate content attrs after write", () => {
      const original = makeSvgWithContentAttr(MXFILE);
      const written = writeDrawioSvgWithMxfile(original, MXFILE2);
      const matches = written.match(/content=/g);
      expect(matches?.length).toBe(1);
    });

    it("round trip: write content-attr SVG then read returns same mxfile", () => {
      const original = makeSvgWithContentAttr(MXFILE);
      const written = writeDrawioSvgWithMxfile(original, MXFILE);
      expect(readDrawioSvg(written)).toBe(MXFILE);
    });
  });

  describe("mxfile child element path", () => {
    it("replaces existing mxfile child element", () => {
      const original = makeSvgWithMxfileChild(MXFILE);
      const written = writeDrawioSvgWithMxfile(original, MXFILE2);
      const result = readDrawioSvg(written);
      expect(result).toContain("updated-content");
      expect(result).not.toContain("test-content");
    });

    it("inserts mxfile child into bare SVG (no existing content attr or mxfile)", () => {
      const written = writeDrawioSvgWithMxfile(makeBaresvg(), MXFILE);
      const result = readDrawioSvg(written);
      expect(result).toContain("mxfile");
      expect(result).toContain("test-content");
    });

    it("round trip: write mxfile-child SVG then read returns equivalent mxfile", () => {
      const original = makeSvgWithMxfileChild(MXFILE);
      const written = writeDrawioSvgWithMxfile(original, MXFILE);
      const result = readDrawioSvg(written);
      expect(result).toContain("test-content");
    });

    it("no duplicate mxfile children after write", () => {
      const original = makeSvgWithMxfileChild(MXFILE);
      const written = writeDrawioSvgWithMxfile(original, MXFILE2);
      const childCount = (written.match(/<mxfile/g) ?? []).length;
      expect(childCount).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("returns input unchanged when SVG root is missing", () => {
      const notSvg = "<div>not svg</div>";
      expect(writeDrawioSvgWithMxfile(notSvg, MXFILE)).toBe(notSvg);
    });
  });
});
