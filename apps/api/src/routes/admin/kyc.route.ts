import { Router } from "express";
import {
  getKycQueue,
  getKycSubmission,
  approveKycSubmission,
  rejectKycSubmission,
} from "../../services/kyc.service";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const queue = await getKycQueue();
    res.json({ data: queue, total: queue.length });
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