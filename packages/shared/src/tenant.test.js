import { describe, expect, it } from "vitest";
import { tenantKey } from "./tenant.js";

describe("tenantKey", () => {
  it("namespaces keys by tenant id", () => {
    const key = tenantKey({ tenantId: "agency-123", isSuperAdmin: false }, "packages", "top20");
    expect(key).toBe("tenant:agency-123:packages:top20");
  });
});
