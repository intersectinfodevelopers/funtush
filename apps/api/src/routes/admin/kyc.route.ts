import { Router } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { parsePagination, buildMeta } from "../../utils/pagination.js";
import {
  getKycQueue,
  countKycQueue,
  getKycSubmission,
  approveKycSubmission,
  rejectKycSubmission,
} from "../../services/kyc.service.js";

const router = Router();

// Was gated only by the IP allow-list (`requireAdmin` on the parent router) —
// require a real platform-admin session too, matching every other admin route.
router.use(requireAuth, requirePlatformPermission("kyc"));

router.get("/", async (req, res) => {
  try {
    const page = parsePagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const [queue, total] = await Promise.all([getKycQueue({ skip: page.skip, take: page.take }), countKycQueue()]);
    res.json({ data: queue, total, meta: buildMeta(total, page.page, page.limit) });
  } catch (err) {
    console.error("[GET /admin/kyc-queue]", err);
    res.status(500).json({ error: "Failed to fetch KYC queue" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const submission = await getKycSubmission(req.params.id);
    if (!submission) { res.status(404).json({ error: "KYC submission not found" }); return; }
    res.json(submission);
  } catch (err) {
    console.error("[GET /admin/kyc/:id]", err);
    res.status(500).json({ error: "Failed to fetch KYC submission" });
  }
});

router.patch("/:id/approve", async (req, res) => {
  try {
    const updated = await approveKycSubmission(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found"))  { res.status(404).json({ error: msg }); return; }
    if (msg.includes("already"))    { res.status(409).json({ error: msg }); return; }
    console.error("[PATCH /admin/kyc/:id/approve]", err);
    res.status(500).json({ error: "Failed to approve KYC submission" });
  }
});

router.patch("/:id/reject", async (req, res) => {
  try {
    const { reason } = req.body as { reason?: string };
    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      res.status(400).json({ error: "reason is required" });
      return;
    }
    const updated = await rejectKycSubmission(req.params.id, reason.trim());
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found"))  { res.status(404).json({ error: msg }); return; }
    if (msg.includes("already"))    { res.status(409).json({ error: msg }); return; }
    console.error("[PATCH /admin/kyc/:id/reject]", err);
    res.status(500).json({ error: "Failed to reject KYC submission" });
  }
});

export default router;