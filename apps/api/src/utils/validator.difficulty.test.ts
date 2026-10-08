import { describe, it, expect } from "vitest";
import { validatePackageInput, normalizeDifficulty, DIFFICULTY_MESSAGE } from "./validator";

/**
 * BUG-202 (QA): POST /agencies/packages rejected lowercase difficulty values even though its own error message
 * told the caller to send lowercase ("Choose a difficulty: easy, moderate, challenging, difficult.").
 */
const base = { title: "Everest Base Camp", durationDays: 14, pricePerPerson: 1200, maxGroupSize: 10 };

describe("difficulty validation", () => {
  it.each(["moderate", "Moderate", "MODERATE", "  moderate  "])("accepts %j and stores the canonical value", (input) => {
    const data = { ...base, difficulty: input };
    expect(() => validatePackageInput(data)).not.toThrow();
    expect(data.difficulty).toBe("MODERATE"); // the service writes exactly this to the database enum
  });

  it("accepts every value the error message itself lists (the message and the validator can't disagree again)", () => {
    const listed = DIFFICULTY_MESSAGE.replace(/^.*: /, "").replace(/\.$/, "").split(", ");
    expect(listed.length).toBeGreaterThan(0);
    for (const value of listed) {
      const data = { ...base, difficulty: value };
      expect(() => validatePackageInput(data)).not.toThrow();
      expect(data.difficulty).toBe(value.toUpperCase());
    }
  });

  it.each([["hard"], [""], [undefined], [null], [3], [["EASY"]]])("rejects %j with the helpful message", (input) => {
    expect(() => validatePackageInput({ ...base, difficulty: input as unknown as string })).toThrow(DIFFICULTY_MESSAGE);
  });

  it("normalizeDifficulty maps any letter case and returns null for anything else", () => {
    expect(normalizeDifficulty("easy")).toBe("EASY");
    expect(normalizeDifficulty("Difficult")).toBe("DIFFICULT");
    expect(normalizeDifficulty("extreme")).toBeNull();
    expect(normalizeDifficulty(undefined)).toBeNull();
  });
});
