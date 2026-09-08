import { prisma, AuditLog, Prisma } from "@funtush/database";
import { hashPassword } from "@funtush/auth";
import { sendStaffInviteEmail } from "../utils/email";

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-8) + "A1!";
}

export const addStaffService = async (
  agencyId: string,
  email: string,
  roleId?: string,
  profile?: { name?: string | null; phone?: string | null }
) => {
  const cleanEmail = email.toLowerCase().trim();

  // 1. Check if a user with this email already exists (identity lives on `User`,
  //    `AgencyUser` is only the agency↔user link table).
  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) {
    const error = new Error("Email already exists") as Error & { status?: number };
    error.status = 409;
    throw error;
  }

  // 2. Validate that the targeted role belongs to this agency if provided
  if (roleId) {
    const validRole = await prisma.role.findFirst({
      where: { id: roleId, agencyId }
    });
    if (!validRole) {
      const error = new Error("The requested role configuration does not exist for your agency.") as Error & { status?: number };
      error.status = 400;
      throw error;
    }
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // 3. Wrap DB calls inside an atomic transaction to ensure safe data creation
  const staff = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Identity record
    const user = await tx.user.create({
      data: {
        email: cleanEmail,
        passwordHash,
        role: "STAFF",
        roleType: "TENANT",
      },
    });

    // Agency ↔ user link
    const agencyUser = await tx.agencyUser.create({
      data: {
        agencyId,
        userId: user.id,
        role: "STAFF",
      },
    });

    // Staff record (points at the AgencyUser link, not the User directly)
    return await tx.agencyStaff.create({
      data: {
        agencyId,
        userId: agencyUser.id,
        roleId: roleId ?? null,
        name: profile?.name?.trim() || null,
        phone: profile?.phone?.trim() || null,
        isActive: true,
      },
      include: {
        user: { select: { id: true, role: true, user: { select: { id: true, email: true } } } },
        role: { select: { id: true, name: true } },
      },
    });
  });

  // Send invite email with temp password. Fire-and-forget best-effort — the
  // staff record is already committed and the temp password is in the response,
  // so a slow / down mail transport must not block or fail the invite.
  void Promise.resolve(sendStaffInviteEmail(cleanEmail, tempPassword, agencyId)).catch(
    (mailErr) => console.error("[addStaffService] invite email failed:", mailErr),
  );

  // Write audit log
  await AuditLog.create({
    agencyId,
    staffId: staff.id,
    userId: staff.userId,
    action: "STAFF_INVITED",
    metadata: { email: cleanEmail, roleId: roleId ?? null },
  });

  return { staff, tempPassword };
};

export const listStaffService = async (agencyId: string) => {
  return await prisma.agencyStaff.findMany({
    where: {
      agencyId,
      isActive: true,
    },
    include: {
      user: { select: { id: true, role: true, user: { select: { id: true, email: true, createdAt: true } } } },
      role: { select: { id: true, name: true } },
    },
    orderBy: { invitedAt: "desc" },
  });
};

export const reassignRoleService = async (
  agencyId: string,
  staffId: string,
  roleId: string
) => {
  // 1. Verify destination role belongs to this agency
  const role = await prisma.role.findFirst({
    where: { id: roleId, agencyId },
  });
  if (!role) {
    const error = new Error("Role not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  // 2. Verify staff belongs to this agency
  const targetStaff = await prisma.agencyStaff.findFirst({
    where: { id: staffId, agencyId },
  });
  if (!targetStaff) {
    const error = new Error("Staff member not found within your agency workspace.") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const updated = await prisma.agencyStaff.update({
    where: { id: staffId },
    data: { roleId },
    include: {
      user: { select: { id: true, user: { select: { id: true, email: true } } } },
      role: { select: { id: true, name: true } },
    },
  });

  // Write audit log
  await AuditLog.create({
    agencyId,
    staffId,
    userId: targetStaff.userId,
    action: "ROLE_REASSIGNED",
    metadata: { oldRoleId: targetStaff.roleId, newRoleId: roleId },
  });

  return updated;
};

/**
 * PATCH /agencies/me/staff/:id — full profile update.
 *
 * `name`/`phone` are agency-scoped and live on the AgencyStaff row. `email` is
 * the login identity on `User` (shared across agencies) — changing it is allowed
 * but guarded by the unique constraint. `roleId` reassigns the custom role.
 */
export const updateStaffProfileService = async (
  agencyId: string,
  staffId: string,
  patch: {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
    roleId?: string | null;
  }
) => {
  const staff = await prisma.agencyStaff.findFirst({
    where: { id: staffId, agencyId },
    include: { user: { select: { id: true, userId: true } } },
  });
  if (!staff) {
    const error = new Error("Staff member not found within your agency workspace.") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  // Validate the target role belongs to this agency (null = clear the role).
  if (patch.roleId !== undefined && patch.roleId !== null) {
    const validRole = await prisma.role.findFirst({ where: { id: patch.roleId, agencyId } });
    if (!validRole) {
      const error = new Error("The requested role configuration does not exist for your agency.") as Error & { status?: number };
      error.status = 400;
      throw error;
    }
  }

  const staffData: Prisma.AgencyStaffUpdateInput = {};
  if (patch.name !== undefined) staffData.name = patch.name?.trim() || null;
  if (patch.phone !== undefined) staffData.phone = patch.phone?.trim() || null;
  if (patch.roleId !== undefined) {
    staffData.role = patch.roleId ? { connect: { id: patch.roleId } } : { disconnect: true };
  }

  const cleanEmail = patch.email?.toLowerCase().trim();

  try {
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (cleanEmail) {
        await tx.user.update({
          where: { id: staff.user.userId },
          data: { email: cleanEmail },
        });
      }
      return await tx.agencyStaff.update({
        where: { id: staffId },
        data: staffData,
        include: {
          user: { select: { id: true, role: true, user: { select: { id: true, email: true } } } },
          role: { select: { id: true, name: true } },
        },
      });
    });

    await AuditLog.create({
      agencyId,
      staffId,
      userId: staff.userId,
      action: "STAFF_UPDATED",
      metadata: {
        fields: Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined),
      },
    });

    return updated;
  } catch (err) {
    if (
      typeof err === "object" && err !== null && "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      const error = new Error("Email already in use by another account") as Error & { status?: number };
      error.status = 409;
      throw error;
    }
    throw err;
  }
};

export const deactivateStaffService = async (
  agencyId: string,
  staffId: string
) => {
  const staff = await prisma.agencyStaff.findFirst({
    where: { id: staffId, agencyId },
  });
  if (!staff) {
    const error = new Error("Staff not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const updated = await prisma.agencyStaff.update({
    where: { id: staffId },
    data: { isActive: false },
  });

  // Write audit log
  await AuditLog.create({
    agencyId,
    staffId,
    userId: staff.userId,
    action: "STAFF_DEACTIVATED",
    metadata: {},
  });

  return updated;
};

export const getStaffActivityService = async (
  agencyId: string,
  staffId: string
) => {
  const staff = await prisma.agencyStaff.findFirst({
    where: { id: staffId, agencyId },
  });
  if (!staff) {
    const error = new Error("Staff not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  return await AuditLog.find({ staffId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();
};