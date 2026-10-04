import { describe, it, expect } from "vitest";
import { availableUpdate, isNewer, isReleaseUrl } from "./update";
import type { HubData } from "../types";

const hub = (app?: { version: string; url: string }): HubData => ({
  version: 2,
  updatedAt: 1,
  games: [],
  codes: [],
  banners: [],
  videos: [],
  ...(app ? { app } : {}),
});

const RELEASE = { version: "0.1.1", url: "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1" };

describe("isNewer", () => {
  it("compares the three numbers as numbers", () => {
    expect(isNewer("0.1.1", "0.1.0")).toBe(true);
    expect(isNewer("0.2.0", "0.1.9")).toBe(true);
    expect(isNewer("1.0.0", "0.9.9")).toBe(true);
    expect(isNewer("0.10.0", "0.9.0")).toBe(true);
  });

  it("the same or an older version is not newer", () => {
    expect(isNewer("0.1.0", "0.1.0")).toBe(false);
    expect(isNewer("0.1.0", "0.1.1")).toBe(false);
    expect(isNewer("0.9.0", "0.10.0")).toBe(false);
  });

  it("a version it cannot read is never newer", () => {
    expect(isNewer("0.2", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0-beta", "0.1.0")).toBe(false);
    expect(isNewer("0.2.0", "dev")).toBe(false);
  });
});

describe("availableUpdate", () => {
  it("returns the release only when it is newer than the running app", () => {
    expect(availableUpdate(hub(RELEASE), "0.1.0")).toEqual(RELEASE);
    expect(availableUpdate(hub(RELEASE), "0.1.1")).toBeNull();
    expect(availableUpdate(hub(RELEASE), "0.2.0")).toBeNull();
  });

  it("nothing to say without data, without the field or before the version is known", () => {
    expect(availableUpdate(null, "0.1.0")).toBeNull();
    expect(availableUpdate(hub(), "0.1.0")).toBeNull();
    expect(availableUpdate(hub(RELEASE), null)).toBeNull();
  });

  it("ignores a newer release whose link is not a release page of this app", () => {
    for (const url of [
      "https://evil.test/Ertezy/Kitsudock/releases/tag/v0.1.1",
      "https://github.com/Someone/Kitsudock/releases/tag/v0.1.1",
      "https://github.com/Ertezy/Kitsudock",
      "http://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1",
      "https://github.com/Ertezy/Kitsudock/releases/../../other/repo/releases/tag/v1",
      "https://github.com/Ertezy/Kitsudock/releases/%2e%2e/%2e%2e/other/repo/releases/tag/v1",
    ]) {
      expect(availableUpdate(hub({ version: "0.1.1", url }), "0.1.0"), url).toBeNull();
    }
  });
});

describe("isReleaseUrl", () => {
  const PREFIX = "https://github.com/Ertezy/Kitsudock/releases/";

  it("accepts release pages of this app", () => {
    for (const url of [
      "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1",
      "https://github.com/Ertezy/Kitsudock/releases/latest",
      "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1?from=app#notes",
      "https://github.com/Ertezy/Kitsudock/releases/tag/v0.1.1.rc.2",
      "https://github.com/Ertezy/Kitsudock/releases/tag/...",
      "https://github.com/Ertezy/Kitsudock/releases/?back=../..",
    ]) {
      expect(isReleaseUrl(url), url).toBe(true);
    }
  });

  it("rejects other addresses", () => {
    for (const url of [
      "",
      "https://github.com/Ertezy/Kitsudock",
      "https://github.com/Ertezy/Kitsudock/releases",
      "https://github.com/ertezy/kitsudock/releases/tag/v0.1.1",
      "https://github.com.evil.test/Ertezy/Kitsudock/releases/tag/v0.1.1",
      "https://github.com@evil.test/Ertezy/Kitsudock/releases/tag/v0.1.1",
    ]) {
      expect(isReleaseUrl(url), url).toBe(false);
    }
  });

  it("rejects a path with a dot segment, written plainly or percent-encoded", () => {
    for (const tail of [
      "../../other/repo/releases/tag/v1",
      "tag/../../../other/repo/releases/tag/v1",
      "./tag/v1",
      "tag/./v1",
      "tag/..",
      "%2e%2e/%2e%2e/other/repo/releases/tag/v1",
      "%2E%2E/other",
      ".%2e/other",
      "%2e./other",
      "tag/%2e/v1",
      "tag/..?x=1",
      "tag/..#x",
    ]) {
      expect(isReleaseUrl(PREFIX + tail), tail).toBe(false);
    }
  });

  it("rejects a backslash, whitespace or a control character anywhere", () => {
    for (const tail of [
      "tag\\..\\..\\x",
      "tag/v1 ",
      "tag/ v1",
      "tag/v1\t",
      "tag/v1\n",
      "tag/v\u00001",
      "tag/v1\u007f",
      "tag/v1\u00a0",
      "tag/v1\u2028",
      // U+FEFF: тот же набор, что в Rust (`is_release_url`), где его отдельно
      // перечисляют: `char::is_whitespace` его пробелом не считает.
      "tag/v1\ufeff",
      "tag/\ufeffv1",
      "tag/v1?x=a\ufeffb",
      "tag/v1#\ufeff",
      "tag/v1?x=a b",
    ]) {
      expect(isReleaseUrl(PREFIX + tail), JSON.stringify(tail)).toBe(false);
    }
  });
});
