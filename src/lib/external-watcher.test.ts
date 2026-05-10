import { describe, it, expect, vi } from "vitest";

vi.mock("obsidian", () => ({}));

import { isDrawioFile, isSelfWriteSuppressed } from "./external-watcher";

describe("isDrawioFile", () => {
  describe("認識される拡張子", () => {
    it(".drawio は true", () => {
      expect(isDrawioFile("diagram.drawio")).toBe(true);
    });

    it(".drawio.svg は true", () => {
      expect(isDrawioFile("diagram.drawio.svg")).toBe(true);
    });

    it(".drawio.png は true", () => {
      expect(isDrawioFile("diagram.drawio.png")).toBe(true);
    });
  });

  describe("認識されない拡張子", () => {
    it(".svg は false", () => {
      expect(isDrawioFile("image.svg")).toBe(false);
    });

    it(".png は false", () => {
      expect(isDrawioFile("image.png")).toBe(false);
    });

    it(".md は false", () => {
      expect(isDrawioFile("note.md")).toBe(false);
    });

    it(".drawiosvg (ドットなし複合) は false", () => {
      expect(isDrawioFile("file.drawiosvg")).toBe(false);
    });

    it("空文字列は false", () => {
      expect(isDrawioFile("")).toBe(false);
    });

    it("drawio を含むが末尾でない → false", () => {
      expect(isDrawioFile("diagram.drawio.backup")).toBe(false);
    });
  });

  describe("大文字小文字の扱い", () => {
    it(".DRAWIO (大文字) は true", () => {
      expect(isDrawioFile("diagram.DRAWIO")).toBe(true);
    });

    it(".Drawio.SVG (混在) は true", () => {
      expect(isDrawioFile("diagram.Drawio.SVG")).toBe(true);
    });

    it(".DRAWIO.PNG (大文字) は true", () => {
      expect(isDrawioFile("diagram.DRAWIO.PNG")).toBe(true);
    });
  });

  describe("パス区切りを含む入力", () => {
    it("ディレクトリパスを含む .drawio は true", () => {
      expect(isDrawioFile("folder/sub/diagram.drawio")).toBe(true);
    });

    it("ディレクトリパスを含む .drawio.svg は true", () => {
      expect(isDrawioFile("vault/diagrams/arch.drawio.svg")).toBe(true);
    });

    it("ディレクトリ名に drawio を含むが拡張子は .md → false", () => {
      expect(isDrawioFile("drawio-folder/note.md")).toBe(false);
    });
  });
});

describe("isSelfWriteSuppressed (echo suppression 判定)", () => {
  const SUPPRESSION_MS = 300;

  describe("recentTs が undefined (自己書き込み記録なし)", () => {
    it("recentTs=undefined → false (suppress しない)", () => {
      expect(isSelfWriteSuppressed(undefined, Date.now(), SUPPRESSION_MS)).toBe(false);
    });
  });

  describe("TTL 内 (suppress すべきケース)", () => {
    it("書き込みから 0ms → suppress", () => {
      const ts = 1000;
      expect(isSelfWriteSuppressed(ts, ts, SUPPRESSION_MS)).toBe(true);
    });

    it("書き込みから TTL-1ms → suppress", () => {
      const ts = 1000;
      expect(isSelfWriteSuppressed(ts, ts + SUPPRESSION_MS - 1, SUPPRESSION_MS)).toBe(true);
    });

    it("書き込みから 1ms → suppress", () => {
      const ts = 5000;
      expect(isSelfWriteSuppressed(ts, ts + 1, SUPPRESSION_MS)).toBe(true);
    });
  });

  describe("TTL 境界と TTL 超過 (suppress しないケース)", () => {
    it("書き込みから TTL ちょうど → suppress しない (now - ts === echoSuppressionMs)", () => {
      const ts = 1000;
      expect(isSelfWriteSuppressed(ts, ts + SUPPRESSION_MS, SUPPRESSION_MS)).toBe(false);
    });

    it("書き込みから TTL+1ms → suppress しない", () => {
      const ts = 1000;
      expect(isSelfWriteSuppressed(ts, ts + SUPPRESSION_MS + 1, SUPPRESSION_MS)).toBe(false);
    });

    it("書き込みから大幅超過 (10000ms) → suppress しない", () => {
      const ts = 1000;
      expect(isSelfWriteSuppressed(ts, ts + 10000, SUPPRESSION_MS)).toBe(false);
    });
  });

  describe("echoSuppressionMs=0 (無効化設定)", () => {
    it("echoSuppressionMs=0 では now===ts でも suppress しない", () => {
      const ts = 1000;
      expect(isSelfWriteSuppressed(ts, ts, 0)).toBe(false);
    });
  });

  describe("echoSuppressionMs 変動ケース", () => {
    it("echoSuppressionMs=1000 では 999ms 以内は suppress", () => {
      const ts = 2000;
      expect(isSelfWriteSuppressed(ts, ts + 999, 1000)).toBe(true);
    });

    it("echoSuppressionMs=1000 では 1000ms は suppress しない", () => {
      const ts = 2000;
      expect(isSelfWriteSuppressed(ts, ts + 1000, 1000)).toBe(false);
    });
  });
});
