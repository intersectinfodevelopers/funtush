// Widgets: no mass-assignment into the profile, validated tracking IDs.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { db } from "@funtush/database";
import { app } from "../../app";
import { dbAvailable, createAgencyContext, type E2EContext } from "./helpers";

const RUN = await dbAvailable();
const d = RUN ? describe : describe.skip;

d("widgets (e2e)", () => {
  let ctx: E2EContext;
  beforeAll(async () => {
    if (RUN) ctx = await createAgencyContext({ tierName: "MEDIUM" });
  });
  afterAll(async () => {
    await ctx?.cleanup();
  });
  const patch = (path: string, body: object) => request(app).patch(`/agencies/me/widgets${path}`).set("x-refresh-token", ctx.refreshToken).send(body);

  it("whatsapp only writes its two fields (cannot flip tier-gated flags)", async () => {
    const r = await patch("/whatsapp", { whatsappEnabled: true, whatsappNumber: "+9779800000000", liveChatEnabled: true, liveChatCode: "<script>x</script>", maxYoutubeVideos: 999, instagramConnected: true });
    expect(r.status).toBe(200);
    const p = await db.agencyProfile.findUnique({ where: { agencyId: ctx.agencyId } });
    expect(p?.whatsappEnabled).toBe(true);
    expect(p?.liveChatEnabled).toBeFalsy();
    expect(p?.liveChatCode).toBeFalsy();
    expect(p?.instagramConnected).toBeFalsy();
    expect(p?.maxYoutubeVideos).not.toBe(999);
  });

  it("rejects a bad whatsapp number and enabling without one", async () => {
    expect((await patch("/whatsapp", { whatsappNumber: "12ab" })).status).toBe(400);
    expect((await patch("/whatsapp", { whatsappNumber: null, whatsappEnabled: true })).status).toBe(400);
  });

  it("validates Google Analytics and Facebook Pixel ids", async () => {
    expect((await patch("/google", { googleAnalyticsId: "G-ABC123XYZ9" })).status).toBe(200);
    expect((await patch("/google", { googleAnalyticsId: "');alert(1);//" })).status).toBe(400);
    expect((await patch("/google", { googleAnalyticsId: "" })).status).toBe(200);
    expect((await patch("/facebook", { facebookPixelId: "1234567890" })).status).toBe(200);
    expect((await patch("/facebook", { facebookPixelId: "abc<script>" })).status).toBe(400);
  });
});
