export interface DrawioUrlOptions {
  spin?: boolean;
  libraries?: boolean;
  noSaveBtn?: boolean;
  noExitBtn?: boolean;
  /** 0: hide the combined "Save & Exit" button. drawio adds this in autosave mode by default. */
  saveAndExit?: boolean;
  autosave?: boolean;
  /** drawio UI theme. "kennedy" (= classic) is drawio.com の従来 UI。 */
  ui?: "kennedy" | "atlas" | "dark" | "min" | "sketch";
  lang?: string;
  /**
   * `configure=1`: drawio が起動時に親へ {event:"configure"} を送り、
   * 親からの {action:"configure", config} を Editor.configure に食わせる正規プロトコルを有効化。
   */
  configure?: boolean;
  extraParams?: Record<string, string | number | boolean>;
}

export function buildDrawioUrl(basePath: string, opts?: DrawioUrlOptions): string {
  const params = new URLSearchParams();
  params.set("embed", "1");
  params.set("proto", "json");
  if (opts?.spin ?? true) params.set("spin", "1");
  if (opts?.libraries ?? true) params.set("libraries", "1");
  if (opts?.configure) params.set("configure", "1");
  if (opts?.noSaveBtn) params.set("noSaveBtn", "1");
  if (opts?.noExitBtn) params.set("noExitBtn", "1");
  // saveAndExit: undefined → drawio's default (added when autosave); false → "0" suppresses it.
  if (opts?.saveAndExit === false) params.set("saveAndExit", "0");
  if (opts?.autosave) params.set("autosave", "1");
  if (opts?.ui) params.set("ui", opts.ui);
  params.set("lang", opts?.lang ?? "ja");
  if (opts?.extraParams) {
    for (const [key, value] of Object.entries(opts.extraParams)) {
      params.set(key, String(value));
    }
  }
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}${params.toString()}`;
}
