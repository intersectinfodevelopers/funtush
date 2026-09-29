import { describe, it, expect } from "vitest";
import { computeAgencyRankScore, smoothRatingScore, type RankSignals } from "./marketplaceRanking.service";

/**
 * The pure ranking maths. No DB — just "given these signals, is the ordering
 * the one the product wants?".
 */

const BASE: RankSignals = {
  tierName: "MEDIUM",
  rating: 4.5,
  reviewCount: 40,
  recentBookings: 3,
  impressions30d: 100,
  clicks30d: 8,
  publishedPackages: 4,
  priorityOverride: 0,
};

describe("smoothRatingScore — no 4.5 cliff", () => {
  it("is monotonic and continuous across the old cliff", () => {
    const at44 = smoothRatingScore(4.4, 50);
    const at45 = smoothRatingScore(4.5, 50);
    const at46 = smoothRatingScore(4.6, 50);
    expect(at44).toBeGreaterThan(0);
    expect(at45).toBeGreaterThan(at44);
    expect(at46).toBeGreaterThan(at45);
    // small step, not a jump
    expect(at45 - at44).toBeLessThan(0.1);
  });

  it("is 0 at 3.0 and below, ~1 at 5.0 with plenty of reviews", () => {
    expect(smoothRatingScore(2.5, 50)).toBe(0);
    expect(smoothRatingScore(3.0, 50)).toBe(0);
    expect(smoothRatingScore(5.0, 200)).toBeGreaterThan(0.9);
  });

  it("damps a high rating that has very few reviews", () => {
    expect(smoothRatingScore(5.0, 1)).toBeLessThan(smoothRatingScore(5.0, 100));
  });

  it("returns 0 for a no-rating agency", () => {
    expect(smoothRatingScore(null, 0)).toBe(0);
  });
});

describe("computeAgencyRankScore — base ordering", () => {
  it("ranks a Large operator above an otherwise-identical Small one", () => {
    const large = computeAgencyRankScore({ ...BASE, tierName: "LARGE" }).score;
    const small = computeAgencyRankScore({ ...BASE, tierName: "SMALL" }).score;
    expect(large).toBeGreaterThan(small);
  });

  it("rewards recent demand and marketplace conversion", () => {
    const quiet = computeAgencyRankScore({ ...BASE, recentBookings: 0, clicks30d: 0 }).score;
    const busy = computeAgencyRankScore({ ...BASE, recentBookings: 25, clicks30d: 20 }).score;
    expect(busy).toBeGreaterThan(quiet);
  });

  it("caps the sponsor boost at 15", () => {
    const a = computeAgencyRankScore({ ...BASE, priorityOverride: 15 }).score;
    const b = computeAgencyRankScore({ ...BASE, priorityOverride: 500 }).score;
    expect(a).toBe(b);
  });

  it("flags reasons: top rated, established, in demand, sponsored", () => {
    const r = computeAgencyRankScore({
      ...BASE,
      tierName: "LARGE",
      rating: 4.9,
      reviewCount: 120,
      recentBookings: 15,
      priorityOverride: 5,
    }).reasons;
    // top 3 only, but the pool should have drawn from these
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r.join(" ")).toMatch(/rated|Established|demand|Sponsored/i);
  });
});

describe("computeAgencyRankScore — personalisation", () => {
  it("floats a completed-with agency into 'trekked-with' with a decisive boost", () => {
    const plain = computeAgencyRankScore(BASE);
    const trekked = computeAgencyRankScore(BASE, {
      completedWithAgency: 2,
      anyBookingsWithAgency: 3,
      regionAffinity: false,
    });
    expect(trekked.relationship).toBe("trekked-with");
    expect(trekked.score).toBeGreaterThan(plain.score + 500);
    expect(trekked.reasons[0]).toMatch(/completed 2 treks with them/);
  });

  it("marks a prior (non-completed) booking as 'booked-before' with a smaller boost", () => {
    const r = computeAgencyRankScore(BASE, {
      completedWithAgency: 0,
      anyBookingsWithAgency: 1,
      regionAffinity: false,
    });
    expect(r.relationship).toBe("booked-before");
    expect(r.reasons[0]).toMatch(/booked with them before/);
    expect(r.score - computeAgencyRankScore(BASE).score).toBeLessThan(100);
  });

  it("gives a small nudge for region affinity only when there's no booking history", () => {
    const affinity = computeAgencyRankScore(BASE, {
      completedWithAgency: 0,
      anyBookingsWithAgency: 0,
      regionAffinity: true,
    });
    expect(affinity.relationship).toBe("recommended");
    expect(affinity.score).toBe(computeAgencyRankScore(BASE).score + 12);
    expect(affinity.reasons).toContain("Operates in a region you've trekked");
  });

  it("ranking guarantees any trekked-with agency beats any non-trekked one", () => {
    const bestStranger = computeAgencyRankScore({
      tierName: "LARGE",
      rating: 5,
      reviewCount: 500,
      recentBookings: 100,
      impressions30d: 1000,
      clicks30d: 400,
      publishedPackages: 20,
      priorityOverride: 15,
    }).score;
    const worstFriend = computeAgencyRankScore(
      { tierName: "SMALL", rating: 3.2, reviewCount: 2, recentBookings: 0, impressions30d: 0, clicks30d: 0, publishedPackages: 1, priorityOverride: 0 },
      { completedWithAgency: 1, anyBookingsWithAgency: 1, regionAffinity: false },
    ).score;
    expect(worstFriend).toBeGreaterThan(bestStranger);
  });
});
