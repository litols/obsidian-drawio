export function readDrawioSvg(svgContent: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) {
      console.warn("[drawio-svg] no <svg> root");
      return "<mxGraphModel/>";
    }

    // 1. content 属性
    const contentAttr = svg.getAttribute("content");
    if (contentAttr) {
      try {
        return atob(contentAttr);
      } catch {
        // continue to step 2
      }
    }

    // 2. <mxfile> 子要素
    const mxfile = svg.querySelector("mxfile");
    if (mxfile) {
      return new XMLSerializer().serializeToString(mxfile);
    }

    console.warn("[drawio-svg] neither content attr nor <mxfile> child found");
    return "<mxGraphModel/>";
  } catch (error) {
    console.warn("[drawio-svg] parse failed:", error);
    return "<mxGraphModel/>";
  }
}

export function writeDrawioSvgWithMxfile(existingSvg: string, newMxfileXml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(existingSvg, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) {
    console.warn("[drawio-svg] cannot serialize (no <svg>)");
    return existingSvg;
  }

  if (svg.hasAttribute("content")) {
    svg.setAttribute("content", btoa(newMxfileXml));
    return new XMLSerializer().serializeToString(doc);
  }

  const oldMxfile = svg.querySelector("mxfile");
  const newDoc = parser.parseFromString(newMxfileXml, "application/xml");
  const newMxfile = newDoc.documentElement;
  if (oldMxfile) {
    svg.replaceChild(doc.importNode(newMxfile, true), oldMxfile);
  } else {
    svg.insertBefore(doc.importNode(newMxfile, true), svg.firstChild);
  }
  return new XMLSerializer().serializeToString(doc);
}
