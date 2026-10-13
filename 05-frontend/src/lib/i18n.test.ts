import { describe, expect, it } from "vitest";
import { pickInitialLang, translate } from "./i18n";

describe("translate", () => {
  it("returns the string for the requested language", () => {
    expect(translate("en", "nav.book")).toBe("Book a room");
    expect(translate("th", "nav.book")).toBe("จองห้องพัก");
  });

  it("falls back to English for an unknown language, then to the key", () => {
    // @ts-expect-error - exercising the runtime fallback path
    expect(translate("fr", "nav.signIn")).toBe("Sign in");
    expect(translate("th", "totally.missing.key")).toBe("totally.missing.key");
  });

  it("fills {name} placeholders from vars", () => {
    expect(translate("en", "search.showingOnly", { name: "Oriental Suite" })).toBe(
      "Showing Oriental Suite only",
    );
    expect(translate("en", "search.nights", { n: 3, ns: "s" })).toBe("3 nights");
    expect(translate("th", "search.nights", { n: 3, ns: "s" })).toBe("3 คืน");
  });

  it("leaves an unfilled placeholder untouched rather than throwing", () => {
    expect(translate("en", "search.showingOnly")).toBe("Showing {name} only");
  });
});

describe("pickInitialLang", () => {
  it("honours a valid stored choice above everything", () => {
    expect(pickInitialLang("th", "en-US")).toBe("th");
    expect(pickInitialLang("en", "th-TH")).toBe("en");
  });

  it("falls back to the browser language when nothing is stored", () => {
    expect(pickInitialLang(null, "th-TH")).toBe("th");
    expect(pickInitialLang(null, "en-GB")).toBe("en");
    expect(pickInitialLang("garbage", "th")).toBe("th");
  });

  it("defaults to English with no signal at all", () => {
    expect(pickInitialLang(null, undefined)).toBe("en");
  });
});
