import { describe, expect, it, vi } from "vitest";

// Mock the pg driver so the connection layer can be exercised without a live
// PostgreSQL server. `vi.hoisted` guarantees the shared mock is created before
// the (also hoisted) import of ./db.js triggers the factory.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("pg", () => ({
  Pool: vi.fn(() => ({ query: mockQuery })),
}));

import { db } from "./db.js";

describe("PostgreSQL connection", () => {
  it("exposes a pooled client with a query method", () => {
    expect(db).toBeDefined();
    expect(typeof db.query).toBe("function");
  });

  it("answers a SELECT 1 connectivity probe", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const result = await db.query("SELECT 1");

    expect(mockQuery).toHaveBeenCalledWith("SELECT 1");
    expect(result.rows).toHaveLength(1);
  });
});
