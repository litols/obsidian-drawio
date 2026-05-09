import pngChunksExtract from "png-chunks-extract";
import pngChunksEncode from "png-chunks-encode";
import pngChunkText from "png-chunk-text";
import { inflate } from "pako";

function decodeZtxtKeyword(data: Uint8Array): string {
  let i = 0;
  while (i < data.length && data[i] !== 0) i++;
  return new TextDecoder("latin1").decode(data.slice(0, i));
}

function decodeZtxtText(data: Uint8Array): string {
  let i = 0;
  while (i < data.length && data[i] !== 0) i++;
  // skip null terminator (i) and compression method byte (i+1)
  const compressed = data.slice(i + 2);
  const inflated = inflate(compressed);
  return new TextDecoder().decode(inflated);
}

export function readDrawioPng(buffer: ArrayBuffer): string {
  try {
    const chunks = pngChunksExtract(new Uint8Array(buffer));
    for (const chunk of chunks) {
      if (chunk.name === "tEXt") {
        try {
          const decoded = pngChunkText.decode(chunk.data);
          if (decoded.keyword === "mxfile") return decoded.text;
        } catch {
          // skip
        }
      }
      // zTXt: png-chunk-text は zTXt 非対応のため手書き decode
      if (chunk.name === "zTXt") {
        try {
          const keyword = decodeZtxtKeyword(chunk.data);
          if (keyword !== "mxfile") continue;
          return decodeZtxtText(chunk.data);
        } catch (e) {
          console.warn("[drawio-png] zTXt mxfile decode failed:", e);
        }
      }
    }
    console.warn("[drawio-png] no mxfile chunk found");
    return "<mxGraphModel/>";
  } catch (error) {
    console.warn("[drawio-png] read failed:", error);
    return "<mxGraphModel/>";
  }
}

export function writeDrawioPngWithMxfile(
  existingPng: ArrayBuffer,
  newMxfileXml: string,
): ArrayBuffer {
  const chunks = pngChunksExtract(new Uint8Array(existingPng));

  const mxfileIndex = chunks.findIndex((chunk) => {
    if (chunk.name === "tEXt") {
      try {
        return pngChunkText.decode(chunk.data).keyword === "mxfile";
      } catch {
        return false;
      }
    }
    if (chunk.name === "zTXt") {
      try {
        return decodeZtxtKeyword(chunk.data) === "mxfile";
      } catch {
        return false;
      }
    }
    return false;
  });

  // 新規チャンクは tEXt で生成 (要件 6.3 は両形式を許容)
  const newChunk = pngChunkText.encode("mxfile", newMxfileXml);

  if (mxfileIndex !== -1) {
    chunks[mxfileIndex] = newChunk;
  } else {
    const iendIndex = chunks.findIndex((chunk) => chunk.name === "IEND");
    if (iendIndex === -1) {
      throw new Error("[drawio-png] PNG missing IEND chunk");
    }
    chunks.splice(iendIndex, 0, newChunk);
  }

  const encoded = pngChunksEncode(chunks);
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
}
