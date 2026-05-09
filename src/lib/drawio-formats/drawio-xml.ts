import { deflateRaw, inflateRaw } from "pako";

export interface ReadDrawioXmlResult {
  xml: string;
  compressed: boolean;
}

export function readDrawioXml(content: string): ReadDrawioXmlResult {
  const trimmed = content.trim();

  if (trimmed.startsWith("<mxfile") || trimmed.startsWith("<mxGraphModel")) {
    return { xml: content, compressed: false };
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "application/xml");
    const diagram = doc.querySelector("diagram");
    if (diagram?.textContent) {
      const base64 = diagram.textContent.trim();
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const inflated = inflateRaw(bytes);
      const xml = new TextDecoder().decode(inflated);
      return { xml, compressed: true };
    }
  } catch (error) {
    console.warn("[drawio-xml] failed to decode compressed diagram:", error);
  }

  return { xml: content, compressed: false };
}

export function writeDrawioXml(xml: string, compressed: boolean): string {
  if (!compressed) return xml;

  const bytes = new TextEncoder().encode(xml);
  const deflated = deflateRaw(bytes);
  let binary = "";
  for (let i = 0; i < deflated.length; i++) binary += String.fromCharCode(deflated[i]);
  const base64 = btoa(binary);
  return `<mxfile><diagram>${base64}</diagram></mxfile>`;
}
