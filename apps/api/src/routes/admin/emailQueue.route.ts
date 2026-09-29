import { Router } from "express";
import { requireAuth } from "@funtush/auth";
import { requirePlatformPermission } from "../../middleware/requirePlatformPermission.middleware";
import { listEmailQueue } from "../../services/kyc.service.js";
import { countEmailQueue, emailQueueSummary } from "../../lib/emailQueue.js";
import { parsePagination, buildMeta } from "../../utils/pagination.js";
import type { EmailStatus } from "../../lib/emailQueue.js";

const router = Router();

// Was gated only by the IP allow-list (`requireAdmin` on the parent router) —
// require a real platform-admin session too, matching every other admin route.
router.use(requireAuth, requirePlatformPermission("email_queue"));

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

    const page = parsePagination(req.query, { defaultLimit: 25, maxLimit: 100 });
    const [emails, total, summary] = await Promise.all([
      listEmailQueue(statuses, { skip: page.skip, limit: page.limit }),
      countEmailQueue({ status: statuses }),
      emailQueueSummary(),
    ]);

    // `summary` is global (all statuses) so the dashboard cards stay correct while
    // a status tab is selected; `total`/`meta` describe the filtered list.
    res.json({ data: emails, summary, total, meta: buildMeta(total, page.page, page.limit) });
  } catch (err) {
    console.error("[GET /admin/email-queue]", err);
    res.status(500).json({ error: "Failed to fetch email queue" });
  }
});

export default router;
