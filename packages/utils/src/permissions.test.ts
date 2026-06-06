import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "./permissions.js";

describe("PERMISSIONS", () => {
  it("uses the resource:action string convention for every permission", () => {
    for (const value of Object.values(PERMISSIONS)) {
      expect(value).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });

  it("exposes the expected booking permissions", () => {
    expect(PERMISSIONS.BOOKING_VIEW).toBe("booking:view");
    expect(PERMISSIONS.BOOKING_CREATE).toBe("booking:create");
  });

  it("has no duplicate permission strings", () => {
    const values = Object.values(PERMISSIONS);
    expect(new Set(values).size).toBe(values.length);
  });
});
