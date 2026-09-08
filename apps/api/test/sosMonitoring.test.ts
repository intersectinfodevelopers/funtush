import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mongo mock with controllable find/findOne/updateOne ────────────────────────
const { findMock, findOneMock, updateOneMock } = vi.hoisted(() => ({
  findMock:      vi.fn(),
  findOneMock:   vi.fn(),
  updateOneMock: vi.fn().mockResolvedValue({ matchedCount: 1 }),
}));

function chainReturning(arr: unknown[]) {
  return {
    sort:  () => ({
      limit:   () => ({ toArray: () => Promise.resolve(arr) }),
      toArray: () => Promise.resolve(arr),
    }),
  };
}

vi.mock("../src/lib/mongo", () => ({
  getMongo: vi.fn().mockResolvedValue({
    collection: vi.fn().mockReturnValue({
      find:        findMock,
      findOne:     findOneMock,
      updateOne:   updateOneMock,
      createIndex: vi.fn().mockResolvedValue("ok"),
    }),
  }),
}));

vi.mock("../src/packages/database/prisma", () => ({
  prisma: {
    agency:        { findUnique: vi.fn() },
    safetyWarning: { create: vi.fn() },
  },
}));

import {
  getActiveIncidents,
  getIncidentHistory,
  addAdminNote,
  exportIncident,
  issueSafetyWarning,
} from "../src/services/sosMonitoring.service";
import { prisma } from "../src/packages/database/prisma";

// A valid 24-char hex ObjectId for tests
const VALID_ID = "507f1f77bcf86cd799439011";

const baseIncident = (overrides: Record<string, unknown> = {}) => ({
  _id:             { toString: () => VALID_ID },
  agency_id:       "agency_1",
  agency_name:     "Himalaya Treks",
  guide_id:        "guide_1",
  guide_name:      "Pemba Sherpa",
  trekker_id:      "trekker_1",
  trekker_name:    "John Doe",
  coordinates:     { lat: 27.9881, lng: 86.9250 },
  status:          "ACTIVE",
  triggered_at:    new Date(),
  acknowledged_at: null,
  resolved_at:     null,
  resolution:      null,
  admin_notes:     [],
  timeline:        [],
  ...overrides,
});

describe("getActiveIncidents()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns active count and incidents", async () => {
    findMock.mockReturnValue(chainReturning([baseIncident(), baseIncident()]));
    const result = await getActiveIncidents();
    expect(result.activeCount).toBe(2);
    expect(result.incidents).toHaveLength(2);
  });

  it("flags acknowledgment overdue when older than 15 min and not acknowledged", async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000);
    findMock.mockReturnValue(chainReturning([baseIncident({ triggered_at: old, acknowledged_at: null })]));
    const result = await getActiveIncidents();
    expect(result.incidents[0].acknowledgmentOverdue).toBe(true);
    expect(result.overdueCount).toBe(1);
  });

  it("does not flag overdue when acknowledged", async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000);
    findMock.mockReturnValue(chainReturning([baseIncident({ triggered_at: old, acknowledged_at: new Date() })]));
    const result = await getActiveIncidents();
    expect(result.incidents[0].acknowledgmentOverdue).toBe(false);
    expect(result.overdueCount).toBe(0);
  });

  it("does not flag overdue when within 15 min", async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    findMock.mockReturnValue(chainReturning([baseIncident({ triggered_at: recent })]));
    const result = await getActiveIncidents();
    expect(result.incidents[0].acknowledgmentOverdue).toBe(false);
  });

  it("includes coordinates and identities in feed", async () => {
    findMock.mockReturnValue(chainReturning([baseIncident()]));
    const result = await getActiveIncidents();
    const inc = result.incidents[0];
    expect(inc.coordinates).toEqual({ lat: 27.9881, lng: 86.9250 });
    expect(inc.agency_name).toBe("Himalaya Treks");
    expect(inc.guide_name).toBe("Pemba Sherpa");
    expect(inc.trekker_name).toBe("John Doe");
  });
});

describe("getIncidentHistory()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns resolved/cancelled incidents with timeline", async () => {
    findMock.mockReturnValue(chainReturning([
      baseIncident({ status: "RESOLVED", resolved_at: new Date(), resolution: "Trekker rescued", timeline: [{ at: new Date(), event: "RESOLVED", actor: "agency_1" }] }),
    ]));
    const result = await getIncidentHistory();
    expect(result.count).toBe(1);
    expect(result.incidents[0].resolution).toBe("Trekker rescued");
    expect(result.incidents[0].timeline).toHaveLength(1);
  });
});

describe("addAdminNote()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("pushes a note and timeline entry", async () => {
    updateOneMock.mockResolvedValue({ matchedCount: 1 });
    const result = await addAdminNote(VALID_ID, "admin_1", "Contacted local rescue team");
    expect(updateOneMock).toHaveBeenCalledOnce();
    const update = updateOneMock.mock.calls[0][1] as Record<string, unknown>;
    expect(update.$push).toBeDefined();
    expect(result.incidentId).toBe(VALID_ID);
  });

  it("throws when note is empty", async () => {
    await expect(addAdminNote(VALID_ID, "admin_1", "  ")).rejects.toThrow("note is required");
  });

  it("throws when incident not found", async () => {
    updateOneMock.mockResolvedValue({ matchedCount: 0 });
    await expect(addAdminNote(VALID_ID, "admin_1", "note")).rejects.toThrow("not found");
  });
});

describe("exportIncident()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns full structured export with all parties", async () => {
    findOneMock.mockResolvedValue(baseIncident({
      timeline: [{ at: new Date(), event: "TRIGGERED", actor: "trekker_1" }],
    }));
    const result = await exportIncident(VALID_ID) as Record<string, unknown>;
    expect(result).toHaveProperty("exportedAt");
    expect((result.agency as Record<string, unknown>).name).toBe("Himalaya Treks");
    expect((result.trekker as Record<string, unknown>).name).toBe("John Doe");
    expect(result.location).toEqual({ lat: 27.9881, lng: 86.9250 });
    expect(result.fullTimeline).toHaveLength(1);
  });

  it("throws when incident not found", async () => {
    findOneMock.mockResolvedValue(null);
    await expect(exportIncident(VALID_ID)).rejects.toThrow("not found");
  });
});

describe("issueSafetyWarning()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a permanent warning record", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue({ id: "agency_1", name: "Himalaya" } as never);
    vi.mocked(prisma.safetyWarning.create).mockResolvedValue({
      id: "warn_1", agencyId: "agency_1", reason: "Late SOS acknowledgment", createdAt: new Date(),
    } as never);
    const result = await issueSafetyWarning("agency_1", "admin_1", "Late SOS acknowledgment") as Record<string, unknown>;
    expect(result.id).toBe("warn_1");
    expect(prisma.safetyWarning.create).toHaveBeenCalledOnce();
  });

  it("throws when reason is empty", async () => {
    await expect(issueSafetyWarning("agency_1", "admin_1", "")).rejects.toThrow("reason is required");
  });

  it("throws when agency not found", async () => {
    vi.mocked(prisma.agency.findUnique).mockResolvedValue(null);
    await expect(issueSafetyWarning("agency_1", "admin_1", "reason")).rejects.toThrow("not found");
  });
});