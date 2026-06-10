import { describe, expect, it, vi } from "vitest";
import { generateSlug } from "./slug";

describe("generateSlug", () => {
  it("slugifies a company name and returns it when no collision exists", async () => {
    const prisma = {
      agency: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const slug = await generateSlug("Himalaya Treks & Tours!", prisma);

    expect(slug).toBe("himalaya-treks-tours");
    expect(prisma.agency.findUnique).toHaveBeenCalledWith({
      where: { slug: "himalaya-treks-tours" },
    });
  });

  it("appends an incrementing counter until a free slug is found", async () => {
    const prisma = {
      agency: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({ slug: "everest-base-camp" })
          .mockResolvedValueOnce({ slug: "everest-base-camp-2" })
          .mockResolvedValueOnce(null),
      },
    };

    const slug = await generateSlug("Everest Base Camp", prisma);

    expect(slug).toBe("everest-base-camp-3");
    expect(prisma.agency.findUnique).toHaveBeenCalledTimes(3);
  });
});
