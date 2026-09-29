import { db } from "@funtush/database";

export class BranchError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

interface BranchPayload {
    name?: unknown;
    address?: unknown;
    phone?: unknown;
    whatsapp?: unknown;
    managerStaffId?: unknown;
    isHeadOffice?: unknown;
}

const BRANCH_LIMIT = {
    FREE: 1,
    SMALL: 1,
    MEDIUM: 3,
    LARGE: Infinity,
};

const PHONE_RE = /^[+()\d][\d\s()+.-]{5,24}$/;

const text = (v: unknown, label: string, max: number): string => {
    if (typeof v !== "string" || !v.trim()) throw new BranchError(`${label} is required.`);
    if (v.trim().length > max) throw new BranchError(`${label} is too long (max ${max} characters).`);
    return v.trim();
};

const phone = (v: unknown, label: string): string => {
    const p = text(v, label, 25);
    if (!PHONE_RE.test(p)) throw new BranchError(`${label} doesn't look like a phone number.`);
    return p;
};

/**
 * Validates and copies ONLY the editable fields. The request body is never
 * spread into Prisma: `agencyId`, `id`, timestamps etc. must not be writable.
 */
function pickBranchFields(body: BranchPayload, partial: boolean) {
    const out: {
        name?: string;
        address?: string;
        phone?: string;
        whatsapp?: string | null;
        managerStaffId?: string | null;
        isHeadOffice?: boolean;
    } = {};
    if (!partial || body.name !== undefined) out.name = text(body.name, "Branch name", 100);
    if (!partial || body.address !== undefined) out.address = text(body.address, "Address", 300);
    if (!partial || body.phone !== undefined) out.phone = phone(body.phone, "Phone");
    if (body.whatsapp !== undefined) out.whatsapp = body.whatsapp === null || body.whatsapp === "" ? null : phone(body.whatsapp, "WhatsApp number");
    if (body.managerStaffId !== undefined) {
        if (body.managerStaffId !== null && body.managerStaffId !== "" && typeof body.managerStaffId !== "string") throw new BranchError("Invalid manager.");
        out.managerStaffId = body.managerStaffId ? (body.managerStaffId as string) : null;
    }
    if (body.isHeadOffice !== undefined) {
        if (typeof body.isHeadOffice !== "boolean") throw new BranchError("isHeadOffice must be true or false.");
        out.isHeadOffice = body.isHeadOffice;
    }
    return out;
}

async function agencyIdOf(agencyUserId: string): Promise<string> {
    const u = await db.agencyUser.findUnique({ where: { id: agencyUserId }, select: { agencyId: true } });
    if (!u) throw new BranchError("Agency user not found", 404);
    return u.agencyId;
}

async function assertNameFree(agencyId: string, name: string, exceptId?: string) {
    const dup = await db.branch.findFirst({
        where: { agencyId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
        select: { id: true },
    });
    if (dup) throw new BranchError("You already have a branch with that name.");
}

const BRANCH_SELECT = {
    id: true,
    name: true,
    address: true,
    phone: true,
    whatsapp: true,
    isHeadOffice: true,
    managerStaffId: true,
    managerStaff: { select: { id: true, name: true } },
    createdAt: true,
    _count: { select: { guides: true, bookings: true, packageBranches: true } },
} as const;

export const createBranchService = async (
    agencyUserId: string,
    data: BranchPayload
) => {
    const agencyId = await agencyIdOf(agencyUserId);
    const fields = pickBranchFields(data ?? {}, false);

    const agency = await db.agency.findUnique({
        where: { id: agencyId },
        select: { id: true, tier: { select: { name: true } } },
    });
    if (!agency) throw new BranchError("Agency not found", 404);

    const totalBranches = await db.branch.count({ where: { agencyId } });
    const tier = agency.tier.name as keyof typeof BRANCH_LIMIT;
    const limit = BRANCH_LIMIT[tier];
    if (totalBranches >= limit) {
        throw new BranchError(`Your ${tier} plan allows only ${limit} branch(es).`);
    }

    await assertNameFree(agencyId, fields.name!);

    if (fields.managerStaffId) {
        const manager = await db.agencyStaff.findFirst({ where: { id: fields.managerStaffId, agencyId, isActive: true } });
        if (!manager) throw new BranchError("Manager does not belong to your agency.");
    }

    if (fields.isHeadOffice === true) {
        const existing = await db.branch.findFirst({ where: { agencyId, isHeadOffice: true } });
        if (existing) throw new BranchError("Head office already exists.");
    }

    return db.branch.create({
        data: {
            agencyId,
            name: fields.name!,
            address: fields.address!,
            phone: fields.phone!,
            whatsapp: fields.whatsapp ?? null,
            managerStaffId: fields.managerStaffId ?? null,
            isHeadOffice: fields.isHeadOffice ?? false,
        },
        select: BRANCH_SELECT,
    });
};

export const updateBranchService = async (
    agencyUserId: string,
    branchId: string,
    data: BranchPayload
) => {
    const agencyId = await agencyIdOf(agencyUserId);
    const branch = await db.branch.findFirst({ where: { id: branchId, agencyId } });
    if (!branch) throw new BranchError("Branch not found", 404);

    const fields = pickBranchFields(data ?? {}, true);

    if (fields.name !== undefined) await assertNameFree(agencyId, fields.name, branch.id);

    if (fields.managerStaffId) {
        const manager = await db.agencyStaff.findFirst({ where: { id: fields.managerStaffId, agencyId, isActive: true } });
        if (!manager) throw new BranchError("Invalid manager");
    }

    if (fields.isHeadOffice === true) {
        const existing = await db.branch.findFirst({ where: { agencyId, isHeadOffice: true, NOT: { id: branch.id } } });
        if (existing) throw new BranchError("Another head office already exists.");
    }

    return db.branch.update({ where: { id: branch.id }, data: fields, select: BRANCH_SELECT });
};

export const deleteBranchService = async (agencyUserId: string, branchId: string) => {
    const agencyId = await agencyIdOf(agencyUserId);
    const branch = await db.branch.findFirst({
        where: { id: branchId, agencyId },
        select: { id: true, _count: { select: { bookings: true } } },
    });
    if (!branch) throw new BranchError("Branch not found", 404);
    // Deleting would silently detach these bookings from their branch's reports.
    if (branch._count.bookings > 0) {
        throw new BranchError(`This branch has ${branch._count.bookings} booking(s) and can't be deleted.`);
    }
    await db.branch.delete({ where: { id: branch.id } });
};

export const getBranchesService = async (
    agencyUserId: string
) => {
    const agencyId = await agencyIdOf(agencyUserId);
    return db.branch.findMany({
        where: { agencyId },
        select: BRANCH_SELECT,
        orderBy: { createdAt: "asc" },
    });
};

interface assignstaffpayload {
    branchId: string
}
interface assignguidepayload {
    branchId: string
}
interface assignpackagepayload {
    branchId: string
    shareAcrossAll: boolean
}

export const assignStaffToBranchService = async (
    agencyUserId: string,
    staffId: string,
    data: assignstaffpayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const staff = await db.agencyStaff.findFirst({
        where: {
            id: staffId,
            agencyId: agencyUser.agencyId
        }
    });

    if (!staff) {
        throw new Error("Staff not found");
    }

    if (!data?.branchId || typeof data.branchId !== "string") {
        throw new Error("Please select a branch.");
    }

    if (data.branchId) {
        const branch = await db.branch.findFirst({
            where: {
                id: data.branchId,
                agencyId: agencyUser.agencyId
            }
        });

        if (!branch) {
            throw new Error("Branch not found");
        }
    }

    const updatedStaff = await db.agencyStaff.update({
        where: {
            id: staff.id
        },
        data: {
            managedBranches: {
                connect: [
                    { id: data.branchId }
                ]
            }
        },
        include: {
            managedBranches: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    return updatedStaff;

}

export const assignGuideToBranchService = async (
    agencyUserId: string,
    guideId: string,
    data: assignguidepayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }

    if (!data.branchId) {
        throw new Error("Please select a branch.");
    }

    const branch = await db.branch.findFirst({
        where: {
            id: data.branchId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true
        }
    });

    if (!branch) {
        throw new Error("Branch not found");
    }

    const guide = await db.guideProfile.findFirst({
        where: {
            id: guideId,
            agencyId: agencyUser.agencyId
        }
    });

    if (!guide) {
        throw new Error("Guide not found");
    }

    if (guide.branchId === data.branchId) {
        throw new Error("Guide is already assigned to this branch");
    }

    const updatedGuide = await db.guideProfile.update({
        where: {
            id: guide.id
        },
        data: {
            branchId: data.branchId
        },
        include: {
            branch: {
                select: {
                    id: true,
                    name: true
                }
            }
        }
    });

    const updatedBranch = await db.branch.findMany({
        where: {
            id: branch.id
        },
        select: {
            guides: true
        }
    });

    return {
        updatedGuide,
        updatedBranch
    };
}

export const assignPackageToBranchService = async (
    agencyUserId: string,
    packageId: string,
    data: assignpackagepayload
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser) {
        throw new Error("Agency user not found");
    }


    // Check package exists and belongs to agency
    const packageItem = await db.trekPackage.findFirst({
        where: {
            id: packageId,
        }
    });

    if (!packageItem) {
        throw new Error("Package not found");
    }

    if (packageItem.agencyId !== agencyUser.agencyId) {
        throw new Error("You cannot assign this package");
    }


    // Share package across all branches
    if (data.shareAcrossAll) {

        if (packageItem.availableToAllBranches === true) {
            throw new Error("Package is already available to all branches");
        }

        return await db.trekPackage.update({
            where: {
                id: packageItem.id
            },
            data: {
                availableToAllBranches: true,
                packageBranches: {
                    deleteMany: {}
                }
            },
            include: {
                packageBranches: {
                    include: {
                        branch: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });
    }


    if (!data.branchId) {
        throw new Error("Please select at least one branch.");
    }


    // Validate branch belongs to same agency
    const branch = await db.branch.findFirst({
        where: {
            id: data.branchId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true
        }
    });

    if (!branch) {
        throw new Error("Invalid branch");
    }

    // Check duplicate assignment
    const existingAssignment = await db.packageBranch.findUnique({
        where: {
            packageId_branchId: {
                packageId,
                branchId: data.branchId
            }
        }
    });

    if (existingAssignment) {
        throw new Error("Package already assigned");
    }


    // Assign package to branches
    return await db.trekPackage.update({
        where: {
            id: packageItem.id
        },
        data: {
            availableToAllBranches: false,

            packageBranches: {
                create: {
                    branch: {
                        connect: {
                            id: data.branchId
                        }
                    }
                }
            }
        },
        include: {
            packageBranches: {
                include: {
                    branch: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        }
    });
};


export const getBranchReportService = async (
    agencyUserId: string,
    branchId: string
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const branch = await db.branch.findFirst({
        where: {
            id: branchId,
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true
        }
    });

    if (!branch)
        throw new Error("Branch not found");

    const totalBookings = await db.booking.count({
        where: {
            branchId
        }
    });

    const confirmedBookings = await db.booking.count({
        where: {
            branchId,
            status: "CONFIRMED"
        }
    });

    const cancelledBookings = await db.booking.count({
        where: {
            branchId,
            status: "CANCELLED"
        }
    });

    const inquiryBookings = await db.booking.count({
        where: {
            branchId,
            status: "INQUIRY"
        }
    });

    const topPackages = await db.booking.groupBy({
        by: ["packageId"],
        where: {
            branchId,
            status: "CONFIRMED"
        },
        _count: {
            packageId: true
        },
        orderBy: {
            _count: {
                packageId: "desc"
            }
        }
    });

    const pkgTitles = new Map(
        (await db.trekPackage.findMany({ where: { id: { in: topPackages.map((t) => t.packageId) } }, select: { id: true, title: true } })).map((p) => [p.id, p.title]),
    );

    const customers = await db.booking.findMany({
        where: {
            branchId
        },
        distinct: ["trekkerId"],
        select: {
            trekkerId: true
        }
    });

    const revenue = await db.booking.aggregate({
        where: {
            branchId,
            status: "CONFIRMED"
        },
        _sum: {
            totalPrice: true
        },
        _avg: {
            totalPrice: true
        }
    });

    return {
        branch,
        totalBookings,
        confirmedBookings,
        cancelledBookings,
        inquiryBookings,
        totalRevenue: revenue._sum.totalPrice ?? 0,
        averageBookingValue: revenue._avg.totalPrice ?? 0,
        totalCustomers: customers.length,
        topPackages: topPackages.slice(0, 5).map((t) => ({ packageId: t.packageId, title: pkgTitles.get(t.packageId) ?? "Package", confirmedBookings: t._count.packageId }))
    };
};

export const getConsolidatedFinanceService = async (
    agencyUserId: string
) => {

    const agencyUser = await db.agencyUser.findUnique({
        where: {
            id: agencyUserId
        },
        select: {
            agencyId: true
        }
    });

    if (!agencyUser)
        throw new Error("Agency user not found");

    const branches = await db.branch.findMany({
        where: {
            agencyId: agencyUser.agencyId
        },
        select: {
            id: true,
            name: true
        }
    });

    const branchReports = await Promise.all(
        branches.map(async (branch) => {

            const bookings = await db.booking.count({
                where: {
                    branchId: branch.id,
                    status: "CONFIRMED"
                }
            });

            const revenue = await db.booking.aggregate({
                where: {
                    branchId: branch.id,
                    status: "CONFIRMED"
                },
                _sum: {
                    totalPrice: true
                }
            });

            return {
                id: branch.id,
                name: branch.name,
                bookings,
                revenue: revenue._sum.totalPrice ?? 0
            };
        })
    );

    const totalBookings = branchReports.reduce(
        (sum, branch) => sum + branch.bookings,
        0
    );

    const totalRevenue = branchReports.reduce(
        (sum, branch) => sum + Number(branch.revenue),
        0
    );

    return {
        totalBranches: branches.length,
        totalBookings,
        totalRevenue,
        branches: branchReports
    };
};