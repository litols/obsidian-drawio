declare module "png-chunks-extract" {
  interface PngChunk {
    name: string;
    data: Uint8Array;
  }
  function extractChunks(data: Uint8Array): PngChunk[];
  export = extractChunks;
}

declare module "png-chunks-encode" {
  interface PngChunk {
    name: string;
    data: Uint8Array;
  }
  function encodeChunks(chunks: PngChunk[]): Uint8Array;
  export = encodeChunks;
}

declare module "png-chunk-text" {
  interface PngTextChunk {
    name: string;
    data: Uint8Array;
  }
  interface PngTextDecoded {
    keyword: string;
    text: string;
  }
  function encode(keyword: string, content: string): PngTextChunk;
  function decode(data: Uint8Array): PngTextDecoded;
  export { encode, decode };
}
