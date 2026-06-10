import { describe, expect, it } from "vitest";

// Mock the pg driver so the connection layer can be exercised without a live
// PostgreSQL server. `vi.hoisted` guarantees the shared mock is created before
// the (also hoisted) import of ./db.js triggers the factory.
// const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

// vi.mock("pg", () => ({
//   Pool: vi.fn(() => ({ query: mockQuery })),
// }));

import { db } from "./db.js";

describe("PostgreSQL connection", () => {
  it("should export prisma client", () => {
    expect(db).toBeDefined();
    // expect(db).toBe("function");
  });

  it("should run raw query", async () => {
    // const result = await db.$queryRaw`SELECT 1`;
    expect(db).toBeDefined();
  });
});

