import { prisma } from "../packages/database/prisma";
import { BugStatus, BugPriority } from "@funtush/database";
import { notificationService } from "./notificationService";

export async function submitBug(
  agencyId: string,
  data: {
    title: string;
    description: string;
    stepsToReproduce?: string;
    screenshotUrl?: string;
  }
) {
  const text = (v: unknown, label: string, max: number, required: boolean): string | undefined => {
    if (v === undefined || v === null || v === "") {
      if (required) throw new Error(`${label} is required`);
      return undefined;
    }
    if (typeof v !== "string") throw new Error(`${label} must be text`);
    const t = v.trim();
    if (!t) {
      if (required) throw new Error(`${label} is required`);
      return undefined;
    }
    if (t.length > max) throw new Error(`${label} must be at most ${max} characters (limit)`);
    return t;
  };
  const title = text(data?.title, "title", 150, true)!;
  const description = text(data?.description, "description", 5000, true)!;
  const stepsToReproduce = text(data?.stepsToReproduce, "stepsToReproduce", 5000, false);
  let screenshotUrl: string | undefined;
  if (data?.screenshotUrl !== undefined && data.screenshotUrl !== null && data.screenshotUrl !== "") {
    // Shown as a link/image to platform admins: http(s) only.
    try {
      const u = new URL(String(data.screenshotUrl));
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
      screenshotUrl = u.toString();
    } catch {
      throw new Error("screenshotUrl must be a valid http(s) URL (required format)");
    }
  }

  return prisma.bugReport.create({
    data: {
      agencyId,
      title,
      description,
      stepsToReproduce,
      screenshotUrl,
      status: "REPORTED",
    },
  });
}

/**
 * `agencyId: null` means "every agency" — the platform-admin Bug Triage view
 * (this same function is reused under both `/agencies/me/bugs`, scoped, and
 * `/admin/bugs`, unscoped; see bug.routes.ts). Explicit, not `undefined`
 * silently dropped from the Prisma `where` — a platform admin has no
 * agencyId of their own, and that shouldn't be an implicit accident.
 */
export async function getAgencyBugs(
  agencyId: string | null,
  status?: string,
  page = 1,
  limit = 20
) {
  const where = {
    ...(agencyId ? { agencyId } : {}),
    ...(status && isValidBugStatus(status) ? { status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.bugReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        agency: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, email: true } },
        hints: {
          orderBy: { createdAt: "asc" },
          include: { createdBy: { select: { id: true, email: true } } },
        },
      },
    }),
    prisma.bugReport.count({ where }),
  ]);

  return { items, total, page, limit };
}

/** Platform staff who can be assigned a bug — powers the Bug Triage assign dropdown. */
export async function listPlatformStaff() {
  return prisma.user.findMany({
    where: { roleType: "PLATFORM" },
    select: { id: true, email: true, role: true },
    orderBy: { email: "asc" },
  });
}

function isValidBugStatus(value: string): value is BugStatus {
  return Object.values(BugStatus).includes(value as BugStatus);
}

export async function setBugPriority(bugId: string, priority: BugPriority) {
  const bug = await prisma.bugReport.findUnique({ where: { id: bugId } });
  if (!bug) throw new Error("Bug report not found");

  return prisma.bugReport.update({
    where: { id: bugId },
    data: { priority },
  });
}

export async function assignBug(bugId: string, assignedToId: string) {
  const [bug, assignee] = await Promise.all([
    prisma.bugReport.findUnique({ where: { id: bugId } }),
    prisma.user.findUnique({ where: { id: assignedToId } }),
  ]);

  if (!bug) throw new Error("Bug report not found");
  if (!assignee) throw new Error("Assignee not found");
  if (assignee.roleType !== "PLATFORM") {
    throw new Error("Can only assign bugs to platform staff");
  }

  return prisma.bugReport.update({
    where: { id: bugId },
    data: {
      assignedToId,
      // Assigning implies work has started, unless already resolved/further along.
      status: bug.status === "REPORTED" ? "IN_PROGRESS" : bug.status,
    },
  });
}

export async function addBugHint(bugId: string, createdById: string, note: string) {
  if (!note?.trim()) throw new Error("hint note is required");

  const bug = await prisma.bugReport.findUnique({
    where: { id: bugId },
    include: { agency: true },
  });
  if (!bug) throw new Error("Bug report not found");

  const hint = await prisma.bugHint.create({
    data: { bugReportId: bugId, createdById, note: note.trim() },
  });

  // Best-effort — a hint is informational, not itself a status change.
  void notificationService.sendEmailNotification(bug.agency.email, "bug_hint_added", {
    bugTitle: bug.title,
    hint: note.trim(),
  });

  return hint;
}

export async function resolveBug(bugId: string, resolutionNote: string) {
  if (!resolutionNote?.trim()) throw new Error("resolution note is required");

  const bug = await prisma.bugReport.findUnique({
    where: { id: bugId },
    include: { agency: true },
  });
  if (!bug) throw new Error("Bug report not found");
  if (bug.status === "RESOLVED") throw new Error("Bug is already resolved");

  const updated = await prisma.bugReport.update({
    where: { id: bugId },
    data: {
      status: "RESOLVED",
      resolutionNote: resolutionNote.trim(),
    },
  });

  void notificationService.sendEmailNotification(bug.agency.email, "bug_resolved", {
    bugTitle: bug.title,
    resolutionNote: resolutionNote.trim(),
  });

 const agencyAdminLink = await prisma.agencyUser.findFirst({
    where: { agencyId: bug.agencyId, role: "AGENCY_ADMIN" },
    include: { user: true },
  });
  if (agencyAdminLink?.user.fcmToken) {
    void notificationService.sendNotification(
      "",
      agencyAdminLink.user.fcmToken,
      `Your bug report "${bug.title}" has been resolved`,
      { priority: "NORMAL" }
    );
  }

  return updated;
}