import { describe, expect, it } from "vitest";
import { validateAcencyInput } from "./validator";

const valid = { email: "agency@example.com", password: "supersecret", phone: "9812345678" };

describe("validateAcencyInput", () => {
  it("accepts a well-formed agency input", () => {
    expect(() => validateAcencyInput(valid)).not.toThrow();
  });

  it("rejects an email without an @", () => {
    expect(() => validateAcencyInput({ ...valid, email: "invalid" })).toThrow("Invalid email format");
  });

  it("rejects a password shorter than 8 characters", () => {
    expect(() => validateAcencyInput({ ...valid, password: "short" })).toThrow(
      "Password must be at least 8 characters",
    );
  });

  it("rejects a phone that is not a 10-digit 98/97 number", () => {
    expect(() => validateAcencyInput({ ...valid, phone: "1234567890" })).toThrow("Invalid phone format");
    expect(() => validateAcencyInput({ ...valid, phone: "981234567" })).toThrow("Invalid phone format");
  });
});
