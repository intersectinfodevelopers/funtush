import { BookingStatus, CouponStatus, db, DiscountType } from "@funtush/database";

interface CreateCouponPayload {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    applicablePackages?: string[];
    minBookingValue?: number | null;
    validFrom: string;
    validUntil: string;
    maxRedemptions: number;
    firstTimeTrekkerOnly?: boolean;
    minGroupSize?: number | null;
    status?: CouponStatus;
}

interface UpdateCouponPayload {
    code?: string;
    discountType?: DiscountType;
    discountValue?: number;
    applicablePackages?: string[];
    minBookingValue?: number | null;
    validFrom?: string;
    validUntil?: string;
    maxRedemptions?: number;
    firstTimeTrekkerOnly?: boolean;
    minGroupSize?: number | null;
    status?: CouponStatus;
}

interface applyCoupon {
    couponCode: string;
    packageId: string;
    bookingValue: number;
    groupSize: number;
    trekkerEmail: string;
}


class CouponError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}
export { CouponError };

const CODE_RE = /^[A-Z0-9_-]{3,30}$/;

const fail = (m: string): never => {
    throw new CouponError(m);
};

const num = (v: unknown, label: string, { int = false, min = 0 } = {}): number => {
    if (typeof v !== "number" || !Number.isFinite(v) || (int && !Number.isInteger(v)) || v < min) {
        return fail(`${label} must be ${int ? "a whole number" : "a number"} of ${min} or more.`);
    }
    return v;
};

const normalizeCode = (v: unknown): string => {
    if (typeof v !== "string" || !v.trim()) return fail("Coupon code is required.");
    const code = v.trim().toUpperCase();
    if (!CODE_RE.test(code)) return fail("Coupon code must be 3-30 letters, numbers, - or _.");
    return code;
};

const parseDate = (v: unknown): Date => {
    const d = typeof v === "string" || v instanceof Date ? new Date(v) : new Date(NaN);
    if (isNaN(d.getTime())) return fail("Invalid date.");
    return d;
};

function checkDiscount(type: unknown, value: number) {
    if (type === DiscountType.PERCENTAGE) {
        if (value <= 0 || value > 100) fail("Percentage discount must be between 1 and 100.");
    } else if (type === DiscountType.FIXED) {
        if (value <= 0) fail("Fixed discount must be greater than 0.");
    } else {
        fail("Discount type must be PERCENTAGE or FIXED.");
    }
}

function checkStatus(v: unknown): CouponStatus {
    if (v !== CouponStatus.ACTIVE && v !== CouponStatus.PAUSED && v !== CouponStatus.EXPIRED) {
        return fail("Status must be ACTIVE, PAUSED or EXPIRED.");
    }
    return v;
}

/** Only this agency's own packages may be listed as applicable. */
async function checkPackages(agencyId: string, v: unknown): Promise<string[]> {
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return fail("Applicable packages must be a list of package ids.");
    const ids = [...new Set(v as string[])];
    if (ids.length === 0) return [];
    const owned = await db.trekPackage.count({ where: { id: { in: ids }, agencyId } });
    if (owned !== ids.length) fail("One or more selected packages don't belong to your agency.");
    return ids;
}

export const createCouponService = async (
    agencyId: string,
    data: CreateCouponPayload
) => {
    const code = normalizeCode(data?.code);
    const discountValue = num(data.discountValue, "Discount value");
    checkDiscount(data.discountType, discountValue);
    const maxRedemptions = num(data.maxRedemptions, "Max redemptions", { int: true, min: 1 });
    const minGroupSize = data.minGroupSize == null ? undefined : num(data.minGroupSize, "Minimum group size", { int: true, min: 1 });
    const minBookingValue = data.minBookingValue == null ? undefined : num(data.minBookingValue, "Minimum booking value");
    const validFrom = parseDate(data.validFrom);
    const validUntil = parseDate(data.validUntil);
    if (validFrom >= validUntil) fail("Valid From must be earlier than Valid Until.");
    const applicablePackages = await checkPackages(agencyId, data.applicablePackages ?? []);

    const existing = await db.coupon.findUnique({ where: { agencyId_code: { agencyId, code } } });
    if (existing) fail("Coupon code already exists.");

    return db.coupon.create({
        data: {
            agencyId,
            code,
            discountType: data.discountType,
            discountValue,
            applicablePackages,
            minBookingValue,
            validFrom,
            validUntil,
            maxRedemptions,
            firstTimeTrekkerOnly: data.firstTimeTrekkerOnly === true,
            minGroupSize,
            status: data.status === undefined ? CouponStatus.ACTIVE : checkStatus(data.status),
        },
    });
};

export const updateCouponService = async (
    agencyId: string,
    couponId: string,
    data: UpdateCouponPayload
) => {
    const coupon = await db.coupon.findFirst({ where: { id: couponId, agencyId } });
    if (!coupon) throw new CouponError("Coupon not found.", 404);

    let code = coupon.code;
    if (data.code !== undefined) {
        code = normalizeCode(data.code);
        const existing = await db.coupon.findUnique({ where: { agencyId_code: { agencyId, code } } });
        if (existing && existing.id !== couponId) fail("Coupon code already exists.");
    }

    // Validate the discount as it will be stored, not just the fields sent.
    const discountType = data.discountType ?? coupon.discountType;
    const discountValue = data.discountValue === undefined ? coupon.discountValue : num(data.discountValue, "Discount value");
    if (data.discountType !== undefined || data.discountValue !== undefined) checkDiscount(discountType, discountValue);

    const maxRedemptions = data.maxRedemptions === undefined ? undefined : num(data.maxRedemptions, "Max redemptions", { int: true, min: 1 });
    if (maxRedemptions !== undefined && maxRedemptions < coupon.redemptionsUsed) {
        fail(`Max redemptions can't be below the ${coupon.redemptionsUsed} already used.`);
    }
    const minGroupSize = data.minGroupSize == null ? data.minGroupSize : num(data.minGroupSize, "Minimum group size", { int: true, min: 1 });
    const minBookingValue = data.minBookingValue == null ? data.minBookingValue : num(data.minBookingValue, "Minimum booking value");

    const validFrom = data.validFrom ? parseDate(data.validFrom) : coupon.validFrom;
    const validUntil = data.validUntil ? parseDate(data.validUntil) : coupon.validUntil;
    if (validFrom >= validUntil) fail("Valid From must be earlier than Valid Until.");

    return db.coupon.update({
        where: { id: couponId },
        data: {
            code,
            discountType,
            discountValue,
            applicablePackages: data.applicablePackages === undefined ? undefined : await checkPackages(agencyId, data.applicablePackages),
            minBookingValue,
            validFrom,
            validUntil,
            maxRedemptions,
            firstTimeTrekkerOnly: data.firstTimeTrekkerOnly === undefined ? undefined : data.firstTimeTrekkerOnly === true,
            minGroupSize,
            status: data.status === undefined ? undefined : checkStatus(data.status),
        },
    });
};

export const deleteCouponService = async (agencyId: string, couponId: string) => {
    const coupon = await db.coupon.findFirst({ where: { id: couponId, agencyId }, select: { id: true } });
    if (!coupon) throw new CouponError("Coupon not found.", 404);
    await db.coupon.delete({ where: { id: couponId } });
};

export const getAgencyCouponsService = async (
    agencyId: string
) => {
    const coupons = await db.coupon.findMany({
        where: {
            agencyId,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    return coupons.map((coupon) => ({
        id: coupon.id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        applicablePackages: coupon.applicablePackages,
        minBookingValue: coupon.minBookingValue,
        validFrom: coupon.validFrom,
        validUntil: coupon.validUntil,
        maxRedemptions: coupon.maxRedemptions,
        redemptionsUsed: coupon.redemptionsUsed,
        remainingRedemptions: coupon.maxRedemptions - coupon.redemptionsUsed,
        firstTimeTrekkerOnly: coupon.firstTimeTrekkerOnly,
        minGroupSize: coupon.minGroupSize,
        status: coupon.status,
        isExpired: coupon.validUntil < new Date(),
        createdAt: coupon.createdAt,
        updatedAt: coupon.updatedAt,
    }));
};

export const validateAndApplyCoupon = async (
    data: applyCoupon
) => {

    const code = data.couponCode.trim().toUpperCase();

    const pkg = await db.trekPackage.findUnique({
        where: {
            id: data.packageId,
        },
        select: {
            agencyId: true,
        },
    });

    if (!pkg) {
        throw new Error("Package not found.");
    }

    const agencyId = pkg.agencyId;

    const coupon = await db.coupon.findUnique({
        where: {
            agencyId_code: {
                agencyId,
                code,
            },
        },
    });

    if (!coupon) {
        throw new Error("Coupon not found.");
    }

    // Active
    if (coupon.status !== CouponStatus.ACTIVE) {
        throw new Error("Coupon is inactive.");
    }

    // Date validation
    const now = new Date();

    if (now < coupon.validFrom) {
        throw new Error("Coupon is not active yet.");
    }

    if (now > coupon.validUntil) {
        throw new Error("Coupon has expired.");
    }

    // Usage limit
    if (
        coupon.maxRedemptions > 0 &&
        coupon.redemptionsUsed >= coupon.maxRedemptions
    ) {
        throw new Error("Coupon usage limit reached.");
    }

    // Minimum booking amount
    if (
        coupon.minBookingValue &&
        data.bookingValue < coupon.minBookingValue
    ) {
        throw new Error(
            `Minimum booking value is Rs.${coupon.minBookingValue}.`
        );
    }

    // Minimum group size
    if (
        coupon.minGroupSize &&
        data.groupSize < coupon.minGroupSize
    ) {
        throw new Error(
            `Minimum group size is ${coupon.minGroupSize}.`
        );
    }

    // Package validation
    if (
        coupon.applicablePackages.length > 0 &&
        !coupon.applicablePackages.includes(data.packageId)
    ) {
        throw new Error(
            "Coupon is not applicable for this package."
        );
    }

    // First-time trekker
    if (coupon.firstTimeTrekkerOnly) {
        const previousBooking = await db.booking.findFirst({
            where: {
                trekkerEmail: data.trekkerEmail,
                status: {
                    not: BookingStatus.REJECTED,
                }
            },
        });

        if (previousBooking) {
            throw new Error(
                "Coupon is only valid for first-time trekkers."
            );
        }
    }

    // Discount calculation
    let discount = 0;

    if (coupon.discountType === DiscountType.PERCENTAGE) {
        discount =
            (data.bookingValue * coupon.discountValue) / 100;
    } else {
        discount = coupon.discountValue;
    }

    // Never discount more than booking value
    discount = Math.min(discount, data.bookingValue);

    const finalAmount = data.bookingValue - discount;

    return {
        couponId: coupon.id,
        couponCode: coupon.code,
        discount,
        originalAmount: data.bookingValue,
        finalAmount,
    };
};