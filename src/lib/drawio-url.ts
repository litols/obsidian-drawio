export interface DrawioUrlOptions {
  spin?: boolean;
  libraries?: boolean;
  noSaveBtn?: boolean;
  noExitBtn?: boolean;
  lang?: string;
  extraParams?: Record<string, string | number | boolean>;
}

export function buildDrawioUrl(basePath: string, opts?: DrawioUrlOptions): string {
  const params = new URLSearchParams();
  params.set("embed", "1");
  params.set("proto", "json");
  if (opts?.spin ?? true) params.set("spin", "1");
  if (opts?.libraries ?? true) params.set("libraries", "1");
  if (opts?.noSaveBtn) params.set("noSaveBtn", "1");
  if (opts?.noExitBtn) params.set("noExitBtn", "1");
  params.set("lang", opts?.lang ?? "ja");
  if (opts?.extraParams) {
    for (const [key, value] of Object.entries(opts.extraParams)) {
      params.set(key, String(value));
    }
  }
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}${params.toString()}`;
}
