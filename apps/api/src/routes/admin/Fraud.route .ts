import { Router } from "express";
import {
  getFraudQueue,
  confirmFraud,
  dismissFraud,
  getBanRegistry,
} from "../../services/fraud.service.js";

const router = Router();

// GET /admin/fraud/queue — flagged accounts, strongest signal first
router.get("/queue", async (req, res) => {
  try {
    const queue = await getFraudQueue();
    res.json({ data: queue, total: queue.length });
  } catch (err) {
    console.error("[GET /admin/fraud/queue]", err);
    res.status(500).json({ error: "Failed to fetch fraud queue" });
  }
});

// GET /admin/fraud/ban-registry — all permanently banned accounts
router.get("/ban-registry", async (req, res) => {
  try {
    const registry = await getBanRegistry();
    res.json({ data: registry, total: registry.length });
  } catch (err) {
    console.error("[GET /admin/fraud/ban-registry]", err);
    res.status(500).json({ error: "Failed to fetch ban registry" });
  }
});

// PATCH /admin/fraud/:id/confirm — ban account + blocklist fingerprint/IP/email
router.patch("/:id/confirm", async (req, res) => {
  try {
    const { reason } = req.body as { reason?: string };
    const updated = await confirmFraud(req.params.id, reason);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("already"))   { res.status(409).json({ error: msg }); return; }
    console.error("[PATCH /admin/fraud/:id/confirm]", err);
    res.status(500).json({ error: "Failed to confirm fraud flag" });
  }
});

// PATCH /admin/fraud/:id/dismiss — clear flag, reset risk, notify agency
router.patch("/:id/dismiss", async (req, res) => {
  try {
    const updated = await dismissFraud(req.params.id);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("not found")) { res.status(404).json({ error: msg }); return; }
    if (msg.includes("already"))   { res.status(409).json({ error: msg }); return; }
    console.error("[PATCH /admin/fraud/:id/dismiss]", err);
    res.status(500).json({ error: "Failed to dismiss fraud flag" });
  }
});

export default router;