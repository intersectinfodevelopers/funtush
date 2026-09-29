import { Router } from "express";
import type { Request, Response } from "express";
import {
  buildReportData,
  monthRange,
  yearRange,
  monthLabel,
  toCSV,
  toPDF,
} from "../../services/report.service";

const router = Router();

/**
 * `reportCache.ts`'s own doc comment says the file bytes live in S3 for 24h
 * and Redis holds a pointer (S3 key + signed URL) — but nothing anywhere in
 * this codebase actually uploads to S3, so every `setCachedReport` call
 * wrote a pointer with `url: ""`. A second request for the same
 * month/format within 24h then hit the `cached` branch below and returned
 * that broken empty-URL JSON instead of the report — worse than no cache at
 * all. Removed both the read and the write rather than ship a cache that
 * cannot return the thing it promises; every request regenerates and
 * streams the file directly, which is what actually worked before.
 */

type Format = "pdf" | "csv";

function parseFormat(q: unknown): Format {
  return q === "csv" ? "csv" : "pdf";
}

/**
 * @openapi
 * /agencies/me/reports/monthly:
 *   get:
 *     tags: [Reports]
 *     summary: Download a monthly report (PDF or CSV)
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: month, in: query, required: true, schema: { type: string, pattern: '^\d{4}-\d{2}$' } }
 *       - { name: format, in: query, schema: { type: string, enum: [pdf, csv] } }
 *     responses:
 *       200: { description: Report file }
 *       400: { description: Missing or malformed month }
 */
router.get("/monthly", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const month = req.query.month as string | undefined;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      res.status(400).json({ error: "month query param required (YYYY-MM)" });
      return;
    }
    const format = parseFormat(req.query.format);

    const range = monthRange(month);
    const data  = await buildReportData(agencyId, range, monthLabel(month));

    if (format === "csv") {
      const csv = toCSV(data);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${month}.csv"`);
      res.send(csv);
      return;
    }

    const pdf = await toPDF(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${month}.pdf"`);
    res.send(pdf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /agencies/me/reports/monthly]", err);
    res.status(400).json({ error: msg });
  }
});

/**
 * @openapi
 * /agencies/me/reports/annual:
 *   get:
 *     tags: [Reports]
 *     summary: Download an annual report (PDF or CSV)
 *     security: [{ refreshToken: [] }]
 *     parameters:
 *       - { name: year, in: query, required: true, schema: { type: string, pattern: '^\d{4}$' } }
 *       - { name: format, in: query, schema: { type: string, enum: [pdf, csv] } }
 *     responses:
 *       200: { description: Report file }
 *       400: { description: Missing or malformed year }
 */
router.get("/annual", async (req: Request, res: Response) => {
  try {
    const agencyId = req.agencyId;
    if (!agencyId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const year = req.query.year as string | undefined;
    if (!year || !/^\d{4}$/.test(year)) {
      res.status(400).json({ error: "year query param required (YYYY)" });
      return;
    }
    const format = parseFormat(req.query.format);

    const range = yearRange(year);
    const data  = await buildReportData(agencyId, range, year);

    if (format === "csv") {
      const csv = toCSV(data);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="report-${year}.csv"`);
      res.send(csv);
      return;
    }

    const pdf = await toPDF(data);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="report-${year}.pdf"`);
    res.send(pdf);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GET /agencies/me/reports/annual]", err);
    res.status(400).json({ error: msg });
  }
});

export default router;
