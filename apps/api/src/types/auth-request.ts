import type { Request } from "express";

export type AgencyUser = {
  id: string;
  role: string;
  agencyId?: string;
  status?: "ACTIVE" | "LOCKED";
  tier?: "FREE" | "SMALL" | "MEDIUM" | "LARGE"
};

export type AgencyRequest = Request & {
  agencyUser?: AgencyUser;
};

export interface UpdateDomainBody {
  domain: string;
}