import { describe, expect, it } from "vitest";
import { classifyDevice } from "./device";
import { initialLayout, layoutFor } from "./layout";

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  // iPadOS Safari asks for desktop sites and sends a Mac UA.
  ipadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

describe("classifyDevice", () => {
  it("phones are mobile", () => {
    expect(classifyDevice(UA.iphone, null)).toBe("mobile");
    expect(classifyDevice(UA.android, null)).toBe("mobile");
  });

  it("the Sec-CH-UA-Mobile hint wins", () => {
    expect(classifyDevice(UA.macChrome, "?1")).toBe("mobile");
    expect(classifyDevice(UA.android, "?0")).toBe("mobile"); // UA still says phone
  });

  it("tablets are left to the width fallback", () => {
    expect(classifyDevice(UA.androidTablet, "?0")).toBe("tablet");
  });

  it("laptops (and iPads in desktop mode) are desktop", () => {
    expect(classifyDevice(UA.macChrome, "?0")).toBe("desktop");
    expect(classifyDevice(UA.ipadDesktopMode, null)).toBe("desktop");
  });

  it("no UA at all is desktop (curl, bots)", () => {
    expect(classifyDevice(null, null)).toBe("desktop");
  });
});

describe("layout", () => {
  it("first render follows the device; tablets start as mobile", () => {
    expect(initialLayout("mobile")).toBe("mobile");
    expect(initialLayout("tablet")).toBe("mobile");
    expect(initialLayout("desktop")).toBe("desktop");
  });

  it("phones stay mobile at any width", () => {
    expect(layoutFor("mobile", 1400)).toBe("mobile");
  });

  it("non-phones switch at 1024 px", () => {
    expect(layoutFor("desktop", 1023)).toBe("mobile");
    expect(layoutFor("desktop", 1024)).toBe("desktop");
    expect(layoutFor("tablet", 1180)).toBe("desktop");
    expect(layoutFor("tablet", 820)).toBe("mobile");
  });
});
