/**
 * ── Request validation for the domain endpoints (backend catch-up pass) ──────
 *
 * Same split every module in this pass uses: this file answers "is this a
 * domain-shaped string"; `domain.service.ts` answers "is this agency allowed
 * to connect one at all" (the paid-tier gate, enforced by `isPaidTier` at the
 * route layer — a whole-endpoint gate, not a per-field one, since connecting
 * a custom domain isn't a screen with some paid and some free fields the way
 * Day 1's colour picker is).
 */

import { z } from "zod";
import { isValidDomain } from "../data/domain";

export const connectDomainSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .refine(isValidDomain, {
        message: "Enter a domain like trekkingagency.com — no https:// or trailing slash.",
      }),
  })
  .strict();

export type ConnectDomainInput = z.infer<typeof connectDomainSchema>;
