import { describe, it, expect } from "vitest";
import { findConfigProblems, assertSecureConfig } from "./assertSecureConfig";

const strong = {
  NODE_ENV: "production",
  JWT_ACCESS_SECRET: "Zr8vQ2mK9xLp4Tn7Wc1Yh6Bd3Fg5Js0Ua8Ve2Ro4Xi",
  JWT_REFRESH_SECRET: "Hb3Nk7Pd1Lw9Qs5Tf2Ym8Gc6Zx4Vr0Ea3Ju7Ao1Mi",
  ENCRYPTION_KEY: "9f3ac71d05b8e2647a1cd93b58e0f426b7ad3915c8e4f0627d1ab39e5c840f7d".slice(0, 64),
} as NodeJS.ProcessEnv;

describe("findConfigProblems / assertSecureConfig", () => {
  it("accepts a properly random production configuration", () => {
    expect(findConfigProblems(strong)).toEqual([]);
    expect(() => assertSecureConfig(strong)).not.toThrow();
  });

  it("rejects the exact values this repository ships in its .env files", () => {
    const repoDefaults = { NODE_ENV: "production", JWT_ACCESS_SECRET: "devsecret", JWT_REFRESH_SECRET: "devsecret", ENCRYPTION_KEY: "0".repeat(64) } as NodeJS.ProcessEnv;
    const problems = findConfigProblems(repoDefaults);
    expect(problems.join("\n")).toMatch(/JWT_ACCESS_SECRET/);
    expect(problems.join("\n")).toMatch(/JWT_REFRESH_SECRET/);
    expect(problems.join("\n")).toMatch(/identical/);
    expect(problems.join("\n")).toMatch(/ENCRYPTION_KEY/);
    expect(() => assertSecureConfig(repoDefaults)).toThrow(/Refusing to start in production/);
  });

  it("rejects identical secrets even when both are long and random", () => {
    const same = { ...strong, JWT_REFRESH_SECRET: strong.JWT_ACCESS_SECRET } as NodeJS.ProcessEnv;
    expect(findConfigProblems(same).join("\n")).toMatch(/identical/);
  });

  it("rejects the admin IP-check bypass, and short/placeholder/low-entropy secrets", () => {
    expect(findConfigProblems({ ...strong, SKIP_ADMIN_IP_CHECK: "true" } as NodeJS.ProcessEnv).join("\n")).toMatch(/SKIP_ADMIN_IP_CHECK/);
    expect(findConfigProblems({ ...strong, JWT_ACCESS_SECRET: "short" } as NodeJS.ProcessEnv).length).toBeGreaterThan(0);
    expect(findConfigProblems({ ...strong, JWT_ACCESS_SECRET: "a".repeat(40) } as NodeJS.ProcessEnv).length).toBeGreaterThan(0);
    expect(findConfigProblems({ ...strong, JWT_ACCESS_SECRET: "please-change-me-".repeat(3) } as NodeJS.ProcessEnv).length).toBeGreaterThan(0);
    expect(findConfigProblems({ ...strong, ENCRYPTION_KEY: undefined } as NodeJS.ProcessEnv).join("\n")).toMatch(/ENCRYPTION_KEY/);
  });

  it("does nothing outside production, so local development keeps its defaults", () => {
    expect(() => assertSecureConfig({ NODE_ENV: "development", JWT_ACCESS_SECRET: "devsecret" } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
