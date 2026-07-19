import { CouponStatus, db, DiscountType } from "@funtush/database";

interface CouponPayload {
    code: string;
    discountType: DiscountType;
    discountValue: number;
    applicablePackages?: string[];
    minBookingValue?: number;
    validFrom: string;
    validUntil: string;
    maxRedemptions: number;
    firstTimeTrekkerOnly?: boolean;
    minGroupSize?: number;
    status?: CouponStatus;
}
export const createCouponService = async (
    agencyId: string,
    data: CouponPayload
) => {

    // Code should not be empty
    if (!data.code.trim()) {
        throw new Error("Coupon code is required.");
    }

    // Normalize coupon code: SAVE10 and save10
    const code = data.code.trim().toUpperCase();

    // Check duplicate code for the same agency
    const existingCoupon = await db.coupon.findUnique({
        where: {
            agencyId_code: {
                agencyId,
                code: data.code,
            },
        },
    });

    if (existingCoupon) {
        throw new Error("Coupon code already exists.");
    }

    // Validate max redemptions
    if (data.maxRedemptions <= 0) {
        throw new Error("Max redemptions must be greater than 0.");
    }

    // Validate minimum group size
    if (
        data.minGroupSize !== undefined &&
        data.minGroupSize < 1
    ) {
        throw new Error("Minimum group size must be at least 1.");
    }

    // Validate minimum booking value
    if (
        data.minBookingValue !== undefined &&
        data.minBookingValue < 0
    ) {
        throw new Error("Minimum booking value cannot be negative.");
    }

    // Parse dates
    const validFrom = new Date(data.validFrom);
    const validUntil = new Date(data.validUntil);

    // Validate dates
    if (
        isNaN(validFrom.getTime()) ||
        isNaN(validUntil.getTime())
    ) {
        throw new Error("Invalid date.");
    }

    if (validFrom >= validUntil) {
        throw new Error(
            "Valid From must be earlier than Valid Until."
        );
    }

    // Validate discount
    if (
        data.discountType === DiscountType.PERCENTAGE &&
        (data.discountValue <= 0 || data.discountValue > 100)
    ) {
        throw new Error("Percentage discount must be between 1 and 100.");
    }

    if (
        data.discountType === DiscountType.FIXED &&
        data.discountValue <= 0
    ) {
        throw new Error("Fixed discount must be greater than 0.");
    }


    const coupon = await db.coupon.create({
        data: {
            agencyId,
            code,
            discountType: data.discountType,
            discountValue: data.discountValue,
            applicablePackages: data.applicablePackages ?? [],
            minBookingValue: data.minBookingValue,
            validFrom,
            validUntil,
            maxRedemptions: data.maxRedemptions,
            firstTimeTrekkerOnly: data.firstTimeTrekkerOnly ?? false,
            minGroupSize: data.minGroupSize,
            status: data.status ?? CouponStatus.ACTIVE,
        },
    });

    return coupon;
};


export const updateCouponService = async (
    agencyId: string,
    couponId: string,
    data: CouponPayload
) => {
    const coupon = await db.coupon.findFirst({
        where: {
            id: couponId,
            agencyId,
        },
    });

    if (!coupon) {
        throw new Error("Coupon not found.");
    }

    let code = coupon.code;

    if (data.code !== undefined) {
        if (!data.code.trim()) {
            throw new Error("Coupon code is required.");
        }

        code = data.code.trim().toUpperCase();

        const existingCoupon = await db.coupon.findUnique({
            where: {
                agencyId_code: {
                    agencyId,
                    code,
                },
            },
        });

        if (
            existingCoupon &&
            existingCoupon.id !== couponId
        ) {
            throw new Error("Coupon code already exists.");
        }
    }

    if (
        data.discountType === DiscountType.PERCENTAGE &&
        data.discountValue !== undefined &&
        (data.discountValue <= 0 ||
            data.discountValue > 100)
    ) {
        throw new Error(
            "Percentage discount must be between 1 and 100."
        );
    }

    if (
        data.discountType === DiscountType.FIXED &&
        data.discountValue !== undefined &&
        data.discountValue <= 0
    ) {
        throw new Error(
            "Fixed discount must be greater than 0."
        );
    }

    if (
        data.maxRedemptions !== undefined &&
        data.maxRedemptions <= 0
    ) {
        throw new Error(
            "Max redemptions must be greater than 0."
        );
    }

    if (
        data.minBookingValue !== undefined &&
        data.minBookingValue < 0
    ) {
        throw new Error(
            "Minimum booking value cannot be negative."
        );
    }

    if (
        data.minGroupSize !== undefined &&
        data.minGroupSize < 1
    ) {
        throw new Error(
            "Minimum group size must be at least 1."
        );
    }

    let validFrom = coupon.validFrom;
    let validUntil = coupon.validUntil;

    if (data.validFrom) {
        validFrom = new Date(data.validFrom);
    }

    if (data.validUntil) {
        validUntil = new Date(data.validUntil);
    }

    if (
        isNaN(validFrom.getTime()) ||
        isNaN(validUntil.getTime())
    ) {
        throw new Error("Invalid date.");
    }

    if (validFrom >= validUntil) {
        throw new Error(
            "Valid From must be earlier than Valid Until."
        );
    }

    return await db.coupon.update({
        where: {
            id: couponId,
        },
        data: {
            code,
            discountType: data.discountType,
            discountValue: data.discountValue,
            applicablePackages:
                data.applicablePackages,
            minBookingValue: data.minBookingValue,
            validFrom,
            validUntil,
            maxRedemptions: data.maxRedemptions,
            firstTimeTrekkerOnly:
                data.firstTimeTrekkerOnly,
            minGroupSize: data.minGroupSize,
            status: data.status,
        },
    });
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
        remainingRedemptions:
            coupon.maxRedemptions - coupon.redemptionsUsed,
        firstTimeTrekkerOnly:
            coupon.firstTimeTrekkerOnly,
        minGroupSize: coupon.minGroupSize,
        status: coupon.status,
        isExpired: coupon.validUntil < new Date(),
        createdAt: coupon.createdAt,
        updatedAt: coupon.updatedAt,
    }));
};