import { describe, it, expect, vi, beforeEach } from "vitest";

const findOne = vi.fn();
const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
const find = vi.fn(() => ({
  sort: () => ({ limit: () => ({ toArray: async () => [] }), toArray: async () => [] }),
}));

vi.mock("../src/models/sosIncident.model", () => ({
  ACK_SLA_MINUTES: 15,
  getSosCollection: vi.fn(async () => ({ findOne, updateOne, find })),
}));
vi.mock("../src/services/sosMonitoring.service", () => ({
  exportIncident: vi.fn(async (id: string) => ({ exportedAt: "now", incidentId: id })),
}));

import {
  getIncident,
  acknowledgeIncident,
  resolveIncident,
  exportIncidentForAgency,
  SafetyError,
} from "../src/services/safety.service";
import { ObjectId } from "mongodb";

const AG = "agency-1";
const ID = new ObjectId().toHexString();

beforeEach(() => {
  vi.clearAllMocks();
  updateOne.mockResolvedValue({ matchedCount: 1 });
  find.mockImplementation(() => ({
    sort: () => ({ limit: () => ({ toArray: async () => [] }), toArray: async () => [] }),
  }));
});

const incident = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(ID),
  agency_id: AG,
  agency_name: "A",
  guide_id: "g1",
  guide_name: "Pasang",
  trekker_id: "t1",
  trekker_name: "John",
  coordinates: { lat: 27.8, lng: 86.7 },
  status: "ACTIVE",
  triggered_at: new Date(),
  acknowledged_at: null,
  resolved_at: null,
  resolution: null,
  admin_notes: [],
  timeline: [],
  ...over,
});

describe("ownership", () => {
  it("404s an incident belonging to another agency", async () => {
    findOne.mockResolvedValue(incident({ agency_id: "someone-else" }));
    await expect(getIncident(AG, ID)).rejects.toMatchObject({ status: 404 });
  });

  it("404s a malformed id without hitting Mongo", async () => {
    await expect(getIncident(AG, "not-an-objectid")).rejects.toBeInstanceOf(SafetyError);
    expect(findOne).not.toHaveBeenCalled();
  });
});

describe("acknowledgeIncident", () => {
  it("moves ACTIVE → ACKNOWLEDGED and sets acknowledged_at", async () => {
    findOne
      .mockResolvedValueOnce(incident()) // loadOwned
      .mockResolvedValueOnce(incident({ status: "ACKNOWLEDGED", acknowledged_at: new Date() })); // re-read
    const out = await acknowledgeIncident(AG, ID, "actor-1");
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.status).toBe("ACKNOWLEDGED");
    expect(setArg.acknowledged_at).toBeInstanceOf(Date);
    expect(out.status).toBe("ACKNOWLEDGED");
  });

  it("409s acknowledging a non-ACTIVE incident", async () => {
    findOne.mockResolvedValue(incident({ status: "RESOLVED" }));
    await expect(acknowledgeIncident(AG, ID, "a")).rejects.toMatchObject({ status: 409 });
  });
});

describe("resolveIncident", () => {
  it("400s without a resolution note", async () => {
    findOne.mockResolvedValue(incident());
    await expect(resolveIncident(AG, ID, "   ", "a")).rejects.toMatchObject({ status: 400 });
  });

  it("409s an already-resolved incident", async () => {
    findOne.mockResolvedValue(incident({ status: "RESOLVED" }));
    await expect(resolveIncident(AG, ID, "handled", "a")).rejects.toMatchObject({ status: 409 });
  });

  it("sets RESOLVED + resolved_at + resolution", async () => {
    findOne
      .mockResolvedValueOnce(incident({ status: "ACKNOWLEDGED" }))
      .mockResolvedValueOnce(incident({ status: "RESOLVED", resolved_at: new Date(), resolution: "handled" }));
    const out = await resolveIncident(AG, ID, "handled", "a");
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.status).toBe("RESOLVED");
    expect(setArg.resolution).toBe("handled");
    expect(out.resolution).toBe("handled");
  });
});

describe("exportIncidentForAgency", () => {
  it("checks ownership then delegates to sosMonitoring.exportIncident", async () => {
    findOne.mockResolvedValue(incident());
    const out = await exportIncidentForAgency(AG, ID);
    expect(out).toMatchObject({ incidentId: ID });
  });
});
