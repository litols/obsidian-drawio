// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import pngChunksExtract from "png-chunks-extract";
import pngChunkText from "png-chunk-text";
import { readDrawioPng, writeDrawioPngWithMxfile } from "./drawio-png";

// CRC-32 implementation for PNG chunk generation
function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const len = new DataView(new ArrayBuffer(4));
  len.setUint32(0, data.length, false);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(nameBytes);
  crcInput.set(data, 4);
  const crcVal = new DataView(new ArrayBuffer(4));
  crcVal.setUint32(0, crc32(crcInput), false);
  const result = new Uint8Array(4 + 4 + data.length + 4);
  result.set(new Uint8Array(len.buffer));
  result.set(nameBytes, 4);
  result.set(data, 8);
  result.set(new Uint8Array(crcVal.buffer), 8 + data.length);
  return result;
}

function makeMinimalPng(extraChunks: Uint8Array[] = []): ArrayBuffer {
  // IHDR: 1x1 8bit RGB
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1); // width
  ihdrView.setUint32(4, 1); // height
  ihdr[8] = 8;
  ihdr[9] = 2; // bit depth, color type RGB

  // IDAT: filter byte 0 + RGB(255,255,255)
  const raw = Buffer.from([0x00, 0xff, 0xff, 0xff]);
  const idat = new Uint8Array(deflateSync(raw));

  // IEND: empty
  const iend = new Uint8Array(0);

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    sig,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", idat),
    ...extraChunks,
    makeChunk("IEND", iend),
  ];

  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    buf.set(p, offset);
    offset += p.length;
  }
  return buf.buffer;
}

function makeZtxtChunk(keyword: string, text: string): Uint8Array {
  const kwBytes = new TextEncoder().encode(keyword);
  const compressed = new Uint8Array(deflateSync(Buffer.from(text, "utf8")));
  // zTXt format: keyword + null + compression_method(0) + compressed_data
  const data = new Uint8Array(kwBytes.length + 1 + 1 + compressed.length);
  data.set(kwBytes);
  data[kwBytes.length] = 0x00; // null terminator
  data[kwBytes.length + 1] = 0x00; // compression method zlib
  data.set(compressed, kwBytes.length + 2);
  return makeChunk("zTXt", data);
}

function makeTExtChunk(keyword: string, text: string): Uint8Array {
  const kwBytes = new TextEncoder().encode(keyword);
  const textBytes = new TextEncoder().encode(text);
  const data = new Uint8Array(kwBytes.length + 1 + textBytes.length);
  data.set(kwBytes);
  data[kwBytes.length] = 0x00;
  data.set(textBytes, kwBytes.length + 1);
  return makeChunk("tEXt", data);
}

const MXFILE = "<mxfile><diagram>test-content</diagram></mxfile>";
const MXFILE2 = "<mxfile><diagram>updated-content</diagram></mxfile>";

describe("readDrawioPng", () => {
  describe("zTXt path", () => {
    it("reads mxfile from zTXt chunk", () => {
      const ztxtChunk = makeZtxtChunk("mxfile", MXFILE);
      const png = makeMinimalPng([ztxtChunk]);
      const result = readDrawioPng(png);
      expect(result).toBe(MXFILE);
    });

    it("ignores zTXt chunk with non-mxfile keyword", () => {
      const ztxtChunk = makeZtxtChunk("other", "some data");
      const png = makeMinimalPng([ztxtChunk]);
      const result = readDrawioPng(png);
      expect(result).toBe("<mxGraphModel/>");
    });
  });

  describe("tEXt path", () => {
    it("reads mxfile from tEXt chunk", () => {
      const textChunk = makeTExtChunk("mxfile", MXFILE);
      const png = makeMinimalPng([textChunk]);
      const result = readDrawioPng(png);
      expect(result).toBe(MXFILE);
    });

    it("ignores tEXt chunk with non-mxfile keyword", () => {
      const textChunk = makeTExtChunk("other", "some data");
      const png = makeMinimalPng([textChunk]);
      const result = readDrawioPng(png);
      expect(result).toBe("<mxGraphModel/>");
    });
  });

  describe("fallback", () => {
    it("returns mxGraphModel/ when no mxfile chunk", () => {
      const png = makeMinimalPng();
      expect(readDrawioPng(png)).toBe("<mxGraphModel/>");
    });

    it("returns mxGraphModel/ for empty buffer", () => {
      expect(readDrawioPng(new ArrayBuffer(0))).toBe("<mxGraphModel/>");
    });

    it("returns mxGraphModel/ for invalid byte sequence", () => {
      const invalid = new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer;
      expect(readDrawioPng(invalid)).toBe("<mxGraphModel/>");
    });
  });
});

describe("writeDrawioPngWithMxfile", () => {
  it("inserts tEXt mxfile chunk into PNG with no existing mxfile chunk", () => {
    const png = makeMinimalPng();
    const result = writeDrawioPngWithMxfile(png, MXFILE);
    expect(readDrawioPng(result)).toBe(MXFILE);
  });

  it("replaces existing tEXt mxfile chunk (no duplication)", () => {
    const png = makeMinimalPng();
    const first = writeDrawioPngWithMxfile(png, MXFILE);
    const second = writeDrawioPngWithMxfile(first, MXFILE2);
    expect(readDrawioPng(second)).toBe(MXFILE2);
    // chunk count should not grow — only one mxfile chunk
    const chunks = pngChunksExtract(new Uint8Array(second));
    const mxfileChunks = chunks.filter((c) => {
      if (c.name === "tEXt") {
        try {
          return pngChunkText.decode(c.data).keyword === "mxfile";
        } catch {
          return false;
        }
      }
      return false;
    });
    expect(mxfileChunks.length).toBe(1);
  });

  it("replaces existing zTXt mxfile chunk with tEXt", () => {
    const ztxtChunk = makeZtxtChunk("mxfile", MXFILE);
    const png = makeMinimalPng([ztxtChunk]);
    const result = writeDrawioPngWithMxfile(png, MXFILE2);
    expect(readDrawioPng(result)).toBe(MXFILE2);
  });

  it("round trips: write then read returns same mxfile", () => {
    const png = makeMinimalPng();
    const written = writeDrawioPngWithMxfile(png, MXFILE);
    expect(readDrawioPng(written)).toBe(MXFILE);
  });
});
