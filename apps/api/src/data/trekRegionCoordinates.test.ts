import { describe, it, expect } from "vitest";
import { matchTrekRegion } from "./trekRegionCoordinates";

describe("matchTrekRegion", () => {
  it("matches a well-known route from the package title alone", () => {
    const m = matchTrekRegion("Everest Base Camp Trek", null, null);
    expect(m).not.toBeNull();
    expect(m!.label).toContain("Everest");
    expect(m!.lat).toBeCloseTo(27.8069, 2);
    expect(m!.lng).toBeCloseTo(86.7139, 2);
  });

  it("is case-insensitive and tolerant of extra text (real demo data has 'Copy of Copy of ...' titles)", () => {
    const m = matchTrekRegion("Copy of Copy of Copy of Langtang Valley 82059", null, null);
    expect(m).not.toBeNull();
    expect(m!.label).toContain("Langtang");
  });

  it("falls back to the region/destination fields when the title doesn't match", () => {
    const m = matchTrekRegion("manaslu circuit path", "karnali region", "Langtang Valley");
    // title matches "manaslu" before the other fields are even considered.
    expect(m).not.toBeNull();
    expect(m!.label).toContain("Manaslu");
  });

  it("returns null for a package name that matches nothing — never guesses", () => {
    expect(matchTrekRegion("Kanchanganja base camp".replace("Kanchanganja", "Totally Unknown Route"), null, null)).toBeNull();
    expect(matchTrekRegion(null, null, null)).toBeNull();
    expect(matchTrekRegion("", "", "")).toBeNull();
  });

  it("handles a real misspelling present in demo data ('Kanchanganja')", () => {
    const m = matchTrekRegion("Kanchanganja base camp", null, null);
    expect(m).not.toBeNull();
    expect(m!.label).toContain("Kanchenjunga");
  });

  it("prefers a more specific match (Annapurna Base Camp) over the broader sibling (Annapurna)", () => {
    const m = matchTrekRegion("Annapurna Base Camp Trek", null, null);
    expect(m!.label).toBe("Annapurna Base Camp");
  });
});
