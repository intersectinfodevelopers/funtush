import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("collapses every Gmail dot/plus alias to one canonical address", () => {
    const canonical = "johndoe@gmail.com";
    for (const alias of [
      "johndoe@gmail.com",
      "john.doe@gmail.com",
      "j.o.h.n.d.o.e@gmail.com",
      "johndoe+agency2@gmail.com",
      "john.doe+a+b@gmail.com",
      "johndoe@googlemail.com",
      "JohnDoe@GMAIL.com",
      "  john.doe@gmail.com  ",
      "john.doe@googlemail.com",
    ]) {
      expect(normalizeEmail(alias), alias).toBe(canonical);
    }
  });

  it("does NOT strip dots/plus for other providers, where they are significant", () => {
    expect(normalizeEmail("John.Doe@Example.com")).toBe("john.doe@example.com");
    expect(normalizeEmail("john+tag@example.com")).toBe("john+tag@example.com");
    expect(normalizeEmail("a.b@outlook.com")).not.toBe(normalizeEmail("ab@outlook.com"));
  });

  it("keeps different Gmail people apart", () => {
    expect(normalizeEmail("alice@gmail.com")).not.toBe(normalizeEmail("bob@gmail.com"));
  });

  it("only treats the LAST @ as the domain separator, and survives malformed input", () => {
    expect(normalizeEmail('"a@b"@gmail.com')).toBe('"a@b"@gmail.com');
    expect(normalizeEmail("no-at-sign")).toBe("no-at-sign");
    expect(normalizeEmail("")).toBe("");
  });
});
