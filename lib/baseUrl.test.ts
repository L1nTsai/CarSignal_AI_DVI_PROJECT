import { describe, expect, it } from "vitest";
import { isLocalHost, pickBaseUrl } from "./baseUrl";

const none = { host: null, forwardedHost: null, forwardedProto: null };

describe("pickBaseUrl", () => {
  it("keeps a real configured address", () => {
    expect(pickBaseUrl("https://a.trycloudflare.com/", { ...none, forwardedHost: "b.trycloudflare.com" })).toBe(
      "https://a.trycloudflare.com",
    );
  });
  it("uses the tunnel the request came through when configured is localhost", () => {
    expect(
      pickBaseUrl("http://localhost:3000", { host: "localhost:3000", forwardedHost: "x.trycloudflare.com", forwardedProto: "https" }),
    ).toBe("https://x.trycloudflare.com");
  });
  it("uses the first of several forwarded hosts", () => {
    expect(pickBaseUrl("http://localhost:3000", { ...none, forwardedHost: "x.trycloudflare.com, proxy.internal" })).toBe(
      "https://x.trycloudflare.com",
    );
  });
  it("stays on localhost when the request is local too", () => {
    expect(pickBaseUrl("http://localhost:3000", { ...none, host: "localhost:3000" })).toBe("http://localhost:3000");
    expect(pickBaseUrl("http://localhost:3000", { ...none, host: "127.0.0.1:3000" })).toBe("http://localhost:3000");
  });
  it("ignores a malformed host", () => {
    expect(pickBaseUrl("http://localhost:3000", { ...none, forwardedHost: "evil.com/path?x=1" })).toBe("http://localhost:3000");
  });
  it("uses a LAN host over http when the proxy said so", () => {
    expect(pickBaseUrl("http://localhost:3000", { ...none, host: "192.168.1.5:3000", forwardedProto: "http" })).toBe(
      "http://192.168.1.5:3000",
    );
  });
});

describe("isLocalHost", () => {
  it("knows the local addresses", () => {
    for (const h of ["localhost", "app.localhost", "127.0.0.1", "[::1]", "0.0.0.0"]) expect(isLocalHost(h)).toBe(true);
    for (const h of ["x.trycloudflare.com", "192.168.1.5"]) expect(isLocalHost(h)).toBe(false);
  });
});
