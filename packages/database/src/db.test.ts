import { describe, expect, it } from "vitest";
import { db } from "./db.js";

describe("Database (Prisma)", () => {
  it("should initialize Prisma client", () => {
    expect(db).toBeDefined();
  });

  it("should support raw queries", () => {
    expect(typeof db.$queryRaw).toBe("function");
  });
});