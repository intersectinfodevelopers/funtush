import { prisma, AuditLog } from "@funtush/database";
import { hashPassword } from "@funtush/auth";
import { sendStaffInviteEmail } from "../utils/email";

function generateTempPassword(): string {
  return Math.random().toString(36).slice(-8) + "A1!";
}

export const addStaffService = async (
  agencyId: string,
  email: string,
  roleId?: string
) => {
  const cleanEmail = email.toLowerCase().trim();

  // 1. Check if user already exists
  const existing = await prisma.agencyUser.findUnique({ where: { email: cleanEmail } });
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
  const staff = await prisma.$transaction(async (tx) => {
    // Create primary core user record
    const user = await tx.agencyUser.create({
      data: {
        email: cleanEmail,
        passwordHash,
        agencyId,
        role: "STAFF",
      },
    });

    // Create the contextual structural link
    return await tx.agencyStaff.create({
      data: {
        agencyId,
        userId: user.id,
        roleId: roleId ?? null,
        isActive: true,
      },
      include: {
        user: { select: { id: true, email: true, role: true } },
        role: { select: { id: true, name: true } },
      },
    });
  });

  // Send invite email with temp password
  await sendStaffInviteEmail(cleanEmail, tempPassword, agencyId);

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
      user: { select: { id: true, email: true, role: true, createdAt: true } },
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
      user: { select: { id: true, email: true } },
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