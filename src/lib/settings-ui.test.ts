import { describe, it, expect } from "vitest";
import { validateCustomLibraryPath, addUniqueEntry } from "./settings-ui";

describe("validateCustomLibraryPath", () => {
  it("空文字は empty を返す", () => {
    expect(validateCustomLibraryPath("")).toBe("empty");
  });

  it("空白のみは empty を返す", () => {
    expect(validateCustomLibraryPath("   ")).toBe("empty");
  });

  it("https URL は externalUrl を返す", () => {
    expect(validateCustomLibraryPath("https://example.com/lib.xml")).toBe("externalUrl");
  });

  it("http URL は externalUrl を返す", () => {
    expect(validateCustomLibraryPath("http://example.com/lib.xml")).toBe("externalUrl");
  });

  it("file スキームは externalUrl を返す", () => {
    expect(validateCustomLibraryPath("file:///etc/lib.xml")).toBe("externalUrl");
  });

  it("app スキームは externalUrl を返す", () => {
    expect(validateCustomLibraryPath("app://local/lib.xml")).toBe("externalUrl");
  });

  it("スキーム区切り :// を含む文字列は externalUrl を返す", () => {
    expect(validateCustomLibraryPath("custom://foo")).toBe("externalUrl");
  });

  it("POSIX 絶対パスは absolute を返す", () => {
    expect(validateCustomLibraryPath("/abs/path/lib.xml")).toBe("absolute");
  });

  it("Windows 絶対パス (バックスラッシュ) は absolute を返す", () => {
    expect(validateCustomLibraryPath("C:\\libs\\lib.xml")).toBe("absolute");
  });

  it("Windows 絶対パス (スラッシュ) は absolute を返す", () => {
    expect(validateCustomLibraryPath("C:/libs/lib.xml")).toBe("absolute");
  });

  it("正常な vault 相対パスは null を返す", () => {
    expect(validateCustomLibraryPath("libraries/custom.xml")).toBeNull();
  });

  it("前後の空白は trim されてから判定される", () => {
    expect(validateCustomLibraryPath("  libraries/custom.xml  ")).toBeNull();
  });
});

describe("addUniqueEntry", () => {
  it("trim して末尾に追加する", () => {
    expect(addUniqueEntry(["a", "b"], "  c  ")).toEqual(["a", "b", "c"]);
  });

  it("既存重複時は元配列をそのまま返す (同一参照)", () => {
    const list = ["a", "b"];
    const result = addUniqueEntry(list, "a");
    expect(result).toBe(list);
  });

  it("trim 後に重複する場合も元配列をそのまま返す", () => {
    const list = ["a", "b"];
    expect(addUniqueEntry(list, "  b  ")).toBe(list);
  });

  it("空文字は変更なしで元配列をそのまま返す", () => {
    const list = ["a"];
    expect(addUniqueEntry(list, "   ")).toBe(list);
  });

  it("新規追加時の順序を維持する", () => {
    expect(addUniqueEntry(["x", "y"], "z")).toEqual(["x", "y", "z"]);
  });

  it("入力配列を破壊しない", () => {
    const list = ["a", "b"];
    addUniqueEntry(list, "c");
    expect(list).toEqual(["a", "b"]);
  });
});
