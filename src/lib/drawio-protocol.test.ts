import { describe, it, expect } from "vitest";
import type {
  DrawioInboundLoad,
  DrawioInboundAutosave,
  DrawioInboundSave,
  DrawioInboundExport,
  DrawioInboundExit,
  DrawioOutboundLoad,
  DrawioOutboundMerge,
  DrawioOutboundConfigure,
  DrawioOutboundExport,
} from "./drawio-protocol";

// Inline type guards — shape 契約のドキュメント化 (drawio-protocol.ts 本体は不変)
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isInboundLoad(v: unknown): v is DrawioInboundLoad {
  return isObj(v) && v["event"] === "load" && typeof v["xml"] === "string";
}

function isInboundAutosave(v: unknown): v is DrawioInboundAutosave {
  return isObj(v) && v["event"] === "autosave" && typeof v["xml"] === "string";
}

function isInboundSave(v: unknown): v is DrawioInboundSave {
  return (
    isObj(v) &&
    v["event"] === "save" &&
    typeof v["xml"] === "string" &&
    (v["exit"] === undefined || typeof v["exit"] === "boolean")
  );
}

function isInboundExport(v: unknown): v is DrawioInboundExport {
  return (
    isObj(v) &&
    v["event"] === "export" &&
    typeof v["data"] === "string" &&
    typeof v["format"] === "string" &&
    isObj(v["message"]) &&
    (v["message"] as Record<string, unknown>)["action"] === "export"
  );
}

function isInboundExit(v: unknown): v is DrawioInboundExit {
  return isObj(v) && v["event"] === "exit";
}

function isOutboundLoad(v: unknown): v is DrawioOutboundLoad {
  return (
    isObj(v) &&
    v["action"] === "load" &&
    typeof v["xml"] === "string" &&
    (v["autosave"] === undefined || v["autosave"] === 0 || v["autosave"] === 1)
  );
}

function isOutboundMerge(v: unknown): v is DrawioOutboundMerge {
  return isObj(v) && v["action"] === "merge" && typeof v["xml"] === "string";
}

function isOutboundConfigure(v: unknown): v is DrawioOutboundConfigure {
  return isObj(v) && v["action"] === "configure" && isObj(v["config"]);
}

const EXPORT_FORMATS = new Set(["png", "svg", "xml", "pdf", "xmlpng", "xmlsvg"]);

function isOutboundExport(v: unknown): v is DrawioOutboundExport {
  return (
    isObj(v) &&
    v["action"] === "export" &&
    typeof v["format"] === "string" &&
    EXPORT_FORMATS.has(v["format"]) &&
    (v["xml"] === undefined || typeof v["xml"] === "string")
  );
}

// 共通の無効入力セット
const INVALID_INPUTS = [null, undefined, 0, "string", true, [], {}];

describe("DrawioInbound type guards", () => {
  describe("isInboundLoad", () => {
    it("returns true for valid load message", () => {
      expect(isInboundLoad({ event: "load", xml: "<mxGraphModel/>" })).toBe(true);
    });
    it("returns true with extra properties", () => {
      expect(isInboundLoad({ event: "load", xml: "<x/>", extra: 1 })).toBe(true);
    });
    it("returns false when xml is missing", () => {
      expect(isInboundLoad({ event: "load" })).toBe(false);
    });
    it("returns false when xml is not a string", () => {
      expect(isInboundLoad({ event: "load", xml: 123 })).toBe(false);
    });
    it("returns false for wrong event", () => {
      expect(isInboundLoad({ event: "autosave", xml: "<x/>" })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isInboundLoad(v)).toBe(false);
    });
  });

  describe("isInboundAutosave", () => {
    it("returns true for valid autosave message", () => {
      expect(isInboundAutosave({ event: "autosave", xml: "<mxGraphModel/>" })).toBe(true);
    });
    it("returns false when xml missing", () => {
      expect(isInboundAutosave({ event: "autosave" })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isInboundAutosave(v)).toBe(false);
    });
  });

  describe("isInboundSave", () => {
    it("returns true for valid save without exit", () => {
      expect(isInboundSave({ event: "save", xml: "<x/>" })).toBe(true);
    });
    it("returns true for valid save with exit: true", () => {
      expect(isInboundSave({ event: "save", xml: "<x/>", exit: true })).toBe(true);
    });
    it("returns true for valid save with exit: false", () => {
      expect(isInboundSave({ event: "save", xml: "<x/>", exit: false })).toBe(true);
    });
    it("returns false when exit is not boolean", () => {
      expect(isInboundSave({ event: "save", xml: "<x/>", exit: 1 })).toBe(false);
    });
    it("returns false when xml missing", () => {
      expect(isInboundSave({ event: "save" })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isInboundSave(v)).toBe(false);
    });
  });

  describe("isInboundExport", () => {
    const validExport = {
      event: "export",
      data: "base64data",
      format: "png",
      message: { action: "export", format: "png" },
    };
    it("returns true for valid export message", () => {
      expect(isInboundExport(validExport)).toBe(true);
    });
    it("returns false when data missing", () => {
      const { data: _, ...rest } = validExport;
      expect(isInboundExport(rest)).toBe(false);
    });
    it("returns false when format missing", () => {
      const { format: _, ...rest } = validExport;
      expect(isInboundExport(rest)).toBe(false);
    });
    it("returns false when message.action is not export", () => {
      expect(isInboundExport({ ...validExport, message: { action: "load", format: "png" } })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isInboundExport(v)).toBe(false);
    });
  });

  describe("isInboundExit", () => {
    it("returns true for valid exit message", () => {
      expect(isInboundExit({ event: "exit" })).toBe(true);
    });
    it("returns true with extra properties", () => {
      expect(isInboundExit({ event: "exit", extra: "ok" })).toBe(true);
    });
    it("returns false for wrong event", () => {
      expect(isInboundExit({ event: "load" })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isInboundExit(v)).toBe(false);
    });
  });
});

describe("DrawioOutbound type guards", () => {
  describe("isOutboundLoad", () => {
    it("returns true for valid load without autosave", () => {
      expect(isOutboundLoad({ action: "load", xml: "<x/>" })).toBe(true);
    });
    it("returns true with autosave: 0", () => {
      expect(isOutboundLoad({ action: "load", xml: "<x/>", autosave: 0 })).toBe(true);
    });
    it("returns true with autosave: 1", () => {
      expect(isOutboundLoad({ action: "load", xml: "<x/>", autosave: 1 })).toBe(true);
    });
    it("returns false when xml missing", () => {
      expect(isOutboundLoad({ action: "load" })).toBe(false);
    });
    it("returns false when autosave is invalid value", () => {
      expect(isOutboundLoad({ action: "load", xml: "<x/>", autosave: 2 })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isOutboundLoad(v)).toBe(false);
    });
  });

  describe("isOutboundMerge", () => {
    it("returns true for valid merge", () => {
      expect(isOutboundMerge({ action: "merge", xml: "<x/>" })).toBe(true);
    });
    it("returns false when xml missing", () => {
      expect(isOutboundMerge({ action: "merge" })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isOutboundMerge(v)).toBe(false);
    });
  });

  describe("isOutboundConfigure", () => {
    it("returns true for valid configure", () => {
      expect(isOutboundConfigure({ action: "configure", config: { key: "val" } })).toBe(true);
    });
    it("returns true for empty config object", () => {
      expect(isOutboundConfigure({ action: "configure", config: {} })).toBe(true);
    });
    it("returns false when config is not an object", () => {
      expect(isOutboundConfigure({ action: "configure", config: "string" })).toBe(false);
    });
    it("returns false when config missing", () => {
      expect(isOutboundConfigure({ action: "configure" })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isOutboundConfigure(v)).toBe(false);
    });
  });

  describe("isOutboundExport", () => {
    it.each(["png", "svg", "xml", "pdf", "xmlpng", "xmlsvg"] as const)(
      "returns true for format %s",
      (format) => {
        expect(isOutboundExport({ action: "export", format })).toBe(true);
      },
    );
    it("returns true with optional xml", () => {
      expect(isOutboundExport({ action: "export", format: "png", xml: "<x/>" })).toBe(true);
    });
    it("returns false for unknown format", () => {
      expect(isOutboundExport({ action: "export", format: "gif" })).toBe(false);
    });
    it("returns false when format missing", () => {
      expect(isOutboundExport({ action: "export" })).toBe(false);
    });
    it("returns false when xml is not a string", () => {
      expect(isOutboundExport({ action: "export", format: "png", xml: 123 })).toBe(false);
    });
    it.each(INVALID_INPUTS)("returns false for %o", (v) => {
      expect(isOutboundExport(v)).toBe(false);
    });
  });
});
