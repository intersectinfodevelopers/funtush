import { describe, expect, it } from "vitest";
import { success, error, paginated } from "./response.js";

describe("success", () => {
  it("wraps data in a success envelope", () => {
    expect(success({ id: 1 })).toEqual({ success: true, data: { id: 1 } });
  });
});

describe("error", () => {
  it("wraps a message and code in an error envelope", () => {
    expect(error("Not found", 404)).toEqual({
      success: false,
      error: { message: "Not found", code: 404 },
    });
  });
});

describe("paginated", () => {
  it("wraps a list together with its pagination metadata", () => {
    const meta = { page: 1, limit: 20, total: 2, totalPages: 1 };
    expect(paginated([1, 2], meta)).toEqual({ success: true, data: [1, 2], meta });
  });
});
