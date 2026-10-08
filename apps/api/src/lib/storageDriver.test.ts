import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLocalStorage } from "@funtush/storage";

/**
 * Which backend uploads use. Production always uses the bucket — unless STORAGE_DRIVER=local is set explicitly,
 * which lets a staging/QA environment with no object store accept uploads (BUG-201 workaround).
 */
const KEYS = ["STORAGE_DRIVER", "STORAGE_ENDPOINT", "NODE_ENV"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("useLocalStorage", () => {
  it("is on in development when no endpoint is configured", () => {
    process.env.NODE_ENV = "development";
    expect(useLocalStorage()).toBe(true);
  });

  it("is off in development when an endpoint is configured", () => {
    process.env.NODE_ENV = "development";
    process.env.STORAGE_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    expect(useLocalStorage()).toBe(false);
  });

  it("is off in production by default — even with no endpoint (production always uses the bucket)", () => {
    process.env.NODE_ENV = "production";
    expect(useLocalStorage()).toBe(false);
  });

  it("is on in production only when STORAGE_DRIVER=local is set explicitly", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_DRIVER = "local";
    expect(useLocalStorage()).toBe(true);
  });

  it("ignores any other STORAGE_DRIVER value", () => {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_DRIVER = "s3";
    expect(useLocalStorage()).toBe(false);
  });
});
