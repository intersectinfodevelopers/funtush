import { Router } from "express";
import { listEmailQueue } from "../../services/kyc.service";
import type { EmailStatus } from "../../lib/emailQueue";



const router = Router();

/**
 * GET /admin/email-queue
 * Returns all emails in the queue.
 */
router.get("/", async (req, res) => {
  try {
    const VALID_STATUSES: EmailStatus[] = ["pending", "sent", "failed"];

    let statuses: EmailStatus[] = VALID_STATUSES;

    if (req.query.status) {
      const requested = (req.query.status as string)
        .split(",")
        .map((s) => s.trim().toLowerCase()) as EmailStatus[];

      const invalid = requested.filter((s) => !VALID_STATUSES.includes(s));
      if (invalid.length) {
        res.status(400).json({
          error: `Invalid status value(s): ${invalid.join(", ")}. Must be one of: ${VALID_STATUSES.join(", ")}`,
        });
        return;
      }

      statuses = requested;
    }

    const emails = await listEmailQueue(statuses);

    // Group by status for convenient consumption by the dashboard
    const grouped = {
      pending: emails.filter((e) => e.status === "pending"),
      sent: emails.filter((e) => e.status === "sent"),
      failed: emails.filter((e) => e.status === "failed"),
    };

    res.json({
      data: emails,
      summary: {
        pending: grouped.pending.length,
        sent: grouped.sent.length,
        failed: grouped.failed.length,
        total: emails.length,
      },
    });
  } catch (err) {
    console.error("[GET /admin/email-queue]", err);
    res.status(500).json({ error: "Failed to fetch email queue" });
  }
});

export default router;
