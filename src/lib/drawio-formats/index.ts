import type { TFile, Vault } from "obsidian";
import { readDrawioXml, writeDrawioXml, type ReadDrawioXmlResult } from "./drawio-xml";
import { readDrawioSvg, writeDrawioSvgWithMxfile } from "./drawio-svg";
import { readDrawioPng, writeDrawioPngWithMxfile } from "./drawio-png";

export {
  readDrawioXml,
  writeDrawioXml,
  readDrawioSvg,
  writeDrawioSvgWithMxfile,
  readDrawioPng,
  writeDrawioPngWithMxfile,
};
export type { ReadDrawioXmlResult };

export type DrawioFormat = "drawio" | "drawio-svg" | "drawio-png";

export interface ReadDrawioResult {
  xml: string;
  format: DrawioFormat;
  compressed: boolean;
}

export interface WriteDrawioOptions {
  compressed?: boolean;
}

export type WriteDrawioPayload =
  | { kind: "xml"; xml: string }
  | { kind: "svg"; exportedSvg: string }
  | { kind: "png"; exportedPng: ArrayBuffer };

function detectFormat(file: TFile): DrawioFormat {
  const name = file.name.toLowerCase();
  if (name.endsWith(".drawio.svg")) return "drawio-svg";
  if (name.endsWith(".drawio.png")) return "drawio-png";
  return "drawio";
}

export async function readDrawioFile(file: TFile, vault: Vault): Promise<ReadDrawioResult> {
  const format = detectFormat(file);
  try {
    if (format === "drawio") {
      const content = await vault.read(file);
      const result = readDrawioXml(content);
      return { xml: result.xml, format, compressed: result.compressed };
    }
    if (format === "drawio-svg") {
      const content = await vault.read(file);
      const xml = readDrawioSvg(content);
      return { xml, format, compressed: false };
    }
    // drawio-png
    const buffer = await vault.readBinary(file);
    const xml = readDrawioPng(buffer);
    return { xml, format, compressed: false };
  } catch (error) {
    console.warn("[drawio-formats] readDrawioFile failed:", error);
    return { xml: "<mxGraphModel/>", format: "drawio", compressed: false };
  }
}

export async function writeDrawioFile(
  file: TFile,
  vault: Vault,
  payload: WriteDrawioPayload,
  format: DrawioFormat,
  options?: WriteDrawioOptions,
): Promise<void> {
  if (format === "drawio") {
    if (payload.kind !== "xml") {
      throw new Error(
        `writeDrawioFile: expected payload.kind='xml' for drawio, got ${payload.kind}`,
      );
    }
    const serialized = writeDrawioXml(payload.xml, options?.compressed ?? false);
    await vault.modify(file, serialized);
    return;
  }
  if (format === "drawio-svg") {
    if (payload.kind !== "svg") {
      throw new Error(
        `writeDrawioFile: expected payload.kind='svg' for drawio-svg, got ${payload.kind}`,
      );
    }
    await vault.modify(file, payload.exportedSvg);
    return;
  }
  // drawio-png
  if (payload.kind !== "png") {
    throw new Error(
      `writeDrawioFile: expected payload.kind='png' for drawio-png, got ${payload.kind}`,
    );
  }
  await vault.modifyBinary(file, payload.exportedPng);
}
