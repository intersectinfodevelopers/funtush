import { Router } from "express";
import {
  listAgencies,
  getAgencyProfile,
  updateAgencyStatus,
  updateAgencyTier,
  issueBreakGlassToken,
} from "../../services/admin.service";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { tier, status, country, search, page, limit } = req.query;

    const result = await listAgencies({
      tier:    tier    as string | undefined,
      status:  status  as string | undefined,
      country: country as string | undefined,
      search:  search  as string | undefined,
      page:    page    ? parseInt(page  as string, 10) : undefined,
      limit:   limit   ? parseInt(limit as string, 10) : undefined,
    });

    res.json(result);
  } catch (err) {
    console.error("[GET /admin/agencies]", err);
    res.status(500).json({ error: "Failed to list agencies" });
  }
});


router.get("/:id", async (req, res) => {
  try {
    const profile = await getAgencyProfile(req.params.id);
    if (!profile) {
      res.status(404).json({ error: "Agency not found" });
      return;
    }
    res.json(profile);
  } catch (err) {
    console.error("[GET /admin/agencies/:id]", err);
    res.status(500).json({ error: "Failed to load agency profile" });
  }
});


router.patch("/:id/status", async (req, res) => {
  try {
    const { status, reason } = req.body as { status?: string; reason?: string };

    const validStatuses = ["ACTIVE", "SUSPENDED", "LOCKED"] as const;
    if (!status || !(validStatuses as readonly string[]).includes(status)) {
      res.status(400).json({
        error: `status must be one of: ${validStatuses.join(", ")}`,
      });
      return;
    }
    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const updated = await updateAgencyStatus(
      req.params.id,
      status as "ACTIVE" | "SUSPENDED" | "LOCKED",
      reason.trim()
    );
    res.json(updated);
  } catch (err) {
    console.error("[PATCH /admin/agencies/:id/status]", err);
    res.status(500).json({ error: "Failed to update agency status" });
  }
});


router.patch("/:id/tier", async (req, res) => {
  try {
    const { tier } = req.body as { tier?: string };
    if (!tier || typeof tier !== "string") {
      res.status(400).json({ error: "tier is required" });
      return;
    }

    const updated = await updateAgencyTier(req.params.id, tier.trim());
    res.json(updated);
  } catch (err) {
    console.error("[PATCH /admin/agencies/:id/tier]", err);
    res.status(500).json({ error: "Failed to update agency tier" });
  }
});

router.post("/:id/break-glass", async (req, res) => {
  try {
    const issuedByIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const result = await issueBreakGlassToken(req.params.id, issuedByIp);
    res.status(201).json(result);
  } catch (err) {
    console.error("[POST /admin/agencies/:id/break-glass]", err);
    res.status(500).json({ error: "Failed to issue break-glass token" });
  }
});

export default router;
