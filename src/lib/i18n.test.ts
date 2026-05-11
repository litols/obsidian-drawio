// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { detectObsidianLocale, getLocale, initI18n, t } from "./i18n";

describe("i18n", () => {
  const originalLanguage = window.localStorage.getItem("language");

  afterEach(() => {
    if (originalLanguage === null) {
      window.localStorage.removeItem("language");
    } else {
      window.localStorage.setItem("language", originalLanguage);
    }
    initI18n("en");
  });

  describe("detectObsidianLocale", () => {
    it("returns 'ja' when localStorage language is 'ja'", () => {
      window.localStorage.setItem("language", "ja");
      expect(detectObsidianLocale()).toBe("ja");
    });

    it("returns 'en' when localStorage language is 'en'", () => {
      window.localStorage.setItem("language", "en");
      expect(detectObsidianLocale()).toBe("en");
    });

    it("falls back to 'en' for unknown languages", () => {
      window.localStorage.setItem("language", "fr");
      expect(detectObsidianLocale()).toBe("en");
    });

    it("falls back to 'en' when language is not set", () => {
      window.localStorage.removeItem("language");
      expect(detectObsidianLocale()).toBe("en");
    });
  });

  describe("initI18n", () => {
    it("uses explicit locale when provided", () => {
      initI18n("ja");
      expect(getLocale()).toBe("ja");
    });

    it("auto-detects from localStorage when locale is omitted", () => {
      window.localStorage.setItem("language", "ja");
      initI18n();
      expect(getLocale()).toBe("ja");
    });
  });

  describe("t", () => {
    it("returns Japanese template when locale is 'ja'", () => {
      initI18n("ja");
      expect(t("common.save")).toBe("保存");
      expect(t("common.cancel")).toBe("キャンセル");
    });

    it("returns English template when locale is 'en'", () => {
      initI18n("en");
      expect(t("common.save")).toBe("Save");
      expect(t("common.cancel")).toBe("Cancel");
    });

    it("expands {name} placeholders", () => {
      initI18n("ja");
      expect(t("notice.saveFailedWithName", { name: "diagram.drawio" })).toBe(
        "drawio: diagram.drawio の保存に失敗しました",
      );
      initI18n("en");
      expect(t("notice.saveFailedWithName", { name: "diagram.drawio" })).toBe(
        "drawio: failed to save diagram.drawio",
      );
    });

    it("leaves unknown placeholders intact", () => {
      initI18n("en");
      expect(t("notice.saveFailedWithName")).toBe("drawio: failed to save {name}");
    });

    it("expands multiple placeholders independently", () => {
      initI18n("ja");
      expect(t("banner.externalUpdatedWithHint", { source: "git pull" })).toBe(
        "外部で更新されました (git pull)",
      );
    });
  });
});
