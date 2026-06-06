import { describe, expect, it, vi } from "vitest";
import { generateSlug } from "./slug";

describe("generateSlug", () => {
  it("slugifies a company name and returns it when no collision exists", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };

    const slug = await generateSlug("Himalaya Treks & Tours!", pool);

    expect(slug).toBe("himalaya-treks-tours");
    expect(pool.query).toHaveBeenCalledWith("SELECT * FROM agency WHERE slug = $1", ["himalaya-treks-tours"]);
  });

  it("appends an incrementing counter until a free slug is found", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ slug: "everest-base-camp" }] }) // base taken
        .mockResolvedValueOnce({ rows: [{ slug: "everest-base-camp2" }] }) // 2 taken
        .mockResolvedValueOnce({ rows: [] }), // 3 free
    };

    const slug = await generateSlug("Everest Base Camp", pool);

    expect(slug).toBe("everest-base-camp3");
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
