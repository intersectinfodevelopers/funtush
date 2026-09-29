import { generateSlug } from "../utils/slug";
import { assertStrongPassword } from "./passwordReset.service";
import { sendTrialExpiredEmail, sendWelcomeEmail } from "../utils/email";
import { smsService } from "./smsService";
import { getPlatformSettings } from "./platformSettings.service";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { generateOTP } from "@funtush/auth";
import { db, redis } from "@funtush/database";
import { validateRegistrationInput } from "../utils/validator";
import { httpError } from "../utils/httpError";
import { normalizeEmail } from "@funtush/shared";


interface CreateAgencyInput {
  name: string;
  email: string;
  password: string;
  phone: string;
  country?: string;
}

// A pending registration (name/email/password/phone) is held here, keyed by
// a one-time session token, for the window between "OTP sent" and "OTP
// verified" — same shape of problem the trekker booking-inquiry OTP flow
// solves (see submitInquiry/verifyInquiryOtp in booking.service.ts), reusing
// the same Redis-backed, TTL-bound pattern rather than inventing a new one.
const agencyOtpKey = (token: string) => `agency-register:otp:${token}`;
const agencyDataKey = (token: string) => `agency-register:data:${token}`;
const agencyAttemptsKey = (token: string) => `agency-register:attempts:${token}`;
// A 6-digit code has only 1M values; unlimited guesses inside the 15-minute
// window would let someone register with a phone they don't own and brute-force
// the code — defeating the whole point of proving the phone is theirs.
const MAX_OTP_ATTEMPTS = 5;
const AGENCY_OTP_TTL = 15 * 60; // 15 minutes — matches the booking-inquiry OTP window

// Nepali numbers are collected/validated in the local 10-digit form
// (^(98|97)\d{8}$ — see validateRegistrationInput); Twilio needs E.164.
const toE164Nepal = (phone: string) => `+977${phone}`;

/**
 * Starts (or, when phone OTP is disabled, immediately completes) agency
 * registration. Whether an OTP step is required is a runtime toggle a
 * super-admin controls via PATCH /admin/settings — see
 * platformSettings.service.ts — not a fixed code path, so this always
 * re-reads the current setting rather than deciding once at startup.
 */
export const createAgency = async (data: CreateAgencyInput) => {
  const { name, email, password, phone } = data;

  // validation
  validateRegistrationInput({ email, password, phone });
  assertStrongPassword(password);
  if (typeof name !== "string" || !name.trim()) {
    throw httpError(400, "Agency name is required");
  }
  if (name.trim().length < 2 || name.trim().length > 100) {
    throw httpError(400, "Agency name must be 2-100 characters");
  }
  if (/[<>]/.test(name)) {
    throw httpError(400, "Agency name must not contain < or >");
  }

  // check duplicate USER (NOT agencyUser) — normalizedEmail catches
  // dot/plus-alias re-registration a plain `email` match would miss (see
  // @funtush/shared's normalizeEmail).
  const existingUser = await db.user.findUnique({
    where: { normalizedEmail: normalizeEmail(email) },
  });

  if (existingUser) {
    const error = new Error("Email already exists") as Error & { status?: number };
    error.status = 409;
    throw error;
  }

  const settings = await getPlatformSettings();
  if (settings.agencyPhoneOtpRequired) {
    const sessionToken = crypto.randomBytes(20).toString("hex");
    const otp = generateOTP();

    await redis.set(agencyDataKey(sessionToken), JSON.stringify({ name, email, password, phone }), "EX", AGENCY_OTP_TTL);
    await redis.set(agencyOtpKey(sessionToken), otp, "EX", AGENCY_OTP_TTL);

    await smsService.sendSMS(
      toE164Nepal(phone),
      `Your Funtush agency registration code is ${otp}. It expires in 15 minutes.`,
    );

    return {
      success: true,
      otpRequired: true,
      message: "OTP sent to your phone. Please verify to complete registration.",
      data: { sessionToken, expiresInSeconds: AGENCY_OTP_TTL },
    };
  }

  return finalizeAgencyRegistration({ name, email, password, phone });
};

/**
 * Completes registration — creates the User + Agency + AgencyUser link,
 * issues a refresh token, sends the welcome email. Shared by both the
 * OTP-disabled path (called immediately from createAgency) and the
 * OTP-enabled path (called from verifyAgencyRegistrationOtp once the code
 * checks out) so the actual account-creation logic exists exactly once.
 */
async function finalizeAgencyRegistration(data: CreateAgencyInput) {
  const { name, email, password } = data;

  // generate unique slug
  const slug = await generateSlug(name, db);

  const trialExpiresAt = new Date();
  trialExpiresAt.setDate(trialExpiresAt.getDate() + 30);

  const hashedPassword = await bcrypt.hash(
    password,
    10
  );

  const rawRefreshToken = crypto.randomBytes(64).toString("hex");
  const tokenHash = await bcrypt.hash(rawRefreshToken, 10);

  // One transaction: previously these were four separate writes, so a failure
  // after the User insert (e.g. the FREE tier row missing) left an orphan User
  // with no Agency — and that orphan then blocked every retry with a stale
  // "Email already exists". Either the whole account exists or none of it does.
  let result;
  try {
    result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          normalizedEmail: normalizeEmail(email),
          passwordHash: hashedPassword,
          role: "AGENCY_ADMIN",
          roleType: "TENANT",
        },
      });

      const agency = await tx.agency.create({
        data: {
          name,
          email,
          slug,
          status: "ACTIVE",
          trialExpiresAt,
          tier: { connect: { name: "FREE" } },
        },
      });

      await tx.agencyUser.create({
        data: { agencyId: agency.id, userId: user.id, role: "AGENCY_ADMIN" },
      });

      const refreshToken = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
        },
      });

      return { agency, refreshToken };
    });
  } catch (err) {
    // Two registrations racing past the duplicate check: the unique index on
    // users.normalized_email / agencies.email/slug is the real arbiter.
    if ((err as { code?: string })?.code === "P2002") {
      throw httpError(409, "Email already exists");
    }
    throw err;
  }
  const { agency, refreshToken } = result;

  // email after registration
  await sendWelcomeEmail(email, name);
  // Note: `phone` (validated, and — when the OTP toggle is on — proven
  // reachable) isn't written to the Agency row here; the agency sets its
  // public contact phone later via the branding/profile endpoints
  // (AgencyProfile.phone) if it wants one displayed on its site.

  return {
    success: true,
    message: "Agency registered successfully",
    data: {
      agencyId: agency.id,
      slug: agency.slug,
      rawRefreshToken: rawRefreshToken,
      refreshToken: refreshToken,
    },
  };
}

export async function verifyAgencyRegistrationOtp(sessionToken: string, otp: string) {
  const storedOtp = await redis.get(agencyOtpKey(sessionToken));
  if (!storedOtp) {
    throw new Error("OTP expired or invalid session");
  }

  const attempts = await redis.incr(agencyAttemptsKey(sessionToken));
  if (attempts === 1) await redis.expire(agencyAttemptsKey(sessionToken), AGENCY_OTP_TTL);
  if (attempts > MAX_OTP_ATTEMPTS) {
    // burn the session: the registrant has to start over (and get a new code)
    await redis.del(agencyOtpKey(sessionToken), agencyDataKey(sessionToken), agencyAttemptsKey(sessionToken));
    throw httpError(429, "Too many incorrect attempts. Please start registration again.");
  }

  if (storedOtp !== otp) {
    throw new Error("Incorrect OTP");
  }

  const raw = await redis.get(agencyDataKey(sessionToken));
  if (!raw) {
    throw new Error("Session data expired");
  }
  const data: CreateAgencyInput = JSON.parse(raw);

  // Re-check: the email could have been taken by a different registration
  // (OTP-disabled, or a separate completed OTP flow) during this session's
  // pending window.
  const existingUser = await db.user.findUnique({ where: { normalizedEmail: normalizeEmail(data.email) } });
  if (existingUser) {
    const error = new Error("Email already exists") as Error & { status?: number };
    error.status = 409;
    throw error;
  }

  await redis.del(agencyOtpKey(sessionToken), agencyDataKey(sessionToken), agencyAttemptsKey(sessionToken));

  return finalizeAgencyRegistration(data);
}



export const lockExpiredAgencies = async () => {
  const now = new Date();
  const BATCH = 500;

  // Locked in batches, and each batch is locked by *id*: the old version read
  // the whole expired set, then ran a second `updateMany` with the same
  // predicate — so an agency whose trial expired between the two statements
  // was locked without ever being emailed, and every expired agency was held
  // in memory at once. Locked agencies leave the `ACTIVE` filter, so the loop
  // drains naturally.
  for (;;) {
    const batch = await db.agency.findMany({
      where: { trialExpiresAt: { lt: now }, status: "ACTIVE" },
      select: { id: true, email: true, name: true },
      orderBy: { id: "asc" },
      take: BATCH,
    });
    if (batch.length === 0) break;

    await db.agency.updateMany({
      where: { id: { in: batch.map((a) => a.id) }, status: "ACTIVE" },
      data: { status: "LOCKED" },
    });

    // email in small parallel groups: sequential is slow at scale, unbounded
    // would hammer the mail provider
    const CONCURRENCY = 10;
    for (let k = 0; k < batch.length; k += CONCURRENCY) {
      await Promise.allSettled(
        batch.slice(k, k + CONCURRENCY).map((a) => sendTrialExpiredEmail(a.email, a.name)),
      );
    }
  }
};


export const getSubscriptionTiers = async () => {
  const tiers = await db.subscriptionTier.findMany();

  if (tiers.length === 0) {
    throw new Error("Tiers not found");
  }

  return {
    tiers,
  };
};


/**
 * Summary for the agency dashboard's home page and header.
 *
 * Returns an explicit shape rather than `include`-ing whole relations: the old
 * version spread the raw agency row, every AgencyUser row and every subscription
 * row (gateway ids and all) into the response, and had no counts at all.
 */
export const getAgencyDashboardService = async (agencyId: string) => {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true,
      name: true,
      email: true,
      slug: true,
      status: true,
      createdAt: true,
      trialExpiresAt: true,
      publishedAt: true,
      customDomain: true,
      customDomainStatus: true,
      tier: {
        select: {
          id: true, name: true, maxStaff: true, maxGuides: true, maxPackages: true,
          maxBookingsPerMonth: true, customDomainEnabled: true, adsEnabled: true,
          blogEnabled: true, analyticsEnabled: true, apiAccessEnabled: true,
        },
      },
      profile: {
        select: {
          logo: true, description: true, address: true, phone: true, email: true, regions: true,
          whatsappEnabled: true, whatsappNumber: true,
        },
      },
      kyc: { select: { status: true, submittedAt: true, rejectionReason: true } },
    },
  });

  if (!agency) {
    throw new Error("Agency not found");
  }

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [bookingGroups, thisMonthGroups, lastMonthGroups, packages, guides, staff] = await Promise.all([
    db.booking.groupBy({ by: ["status"], where: { agencyId }, _count: { _all: true } }),
    // Bookings CREATED this month / last month, by their current status — the basis of "from last month" on the bookings page.
    db.booking.groupBy({ by: ["status"], where: { agencyId, createdAt: { gte: thisMonthStart } }, _count: { _all: true } }),
    db.booking.groupBy({ by: ["status"], where: { agencyId, createdAt: { gte: lastMonthStart, lt: thisMonthStart } }, _count: { _all: true } }),
    db.trekPackage.count({ where: { agencyId, status: { not: "ARCHIVED" } } }),
    db.guideProfile.count({ where: { agencyId, isActive: true } }),
    db.agencyUser.count({ where: { agencyId } }),
  ]);

  const bookingsByStatus: Record<string, number> = {};
  for (const g of bookingGroups) bookingsByStatus[g.status] = g._count._all;
  const totalBookings = Object.values(bookingsByStatus).reduce((a, b) => a + b, 0);
  const toMap = (groups: { status: string; _count: { _all: number } }[]) => Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>;

  return {
    agency,
    stats: {
      totalBookings,
      bookingsByStatus,
      bookingsCreatedByStatus: { thisMonth: toMap(thisMonthGroups), lastMonth: toMap(lastMonthGroups) },
      pendingInquiries: bookingsByStatus.INQUIRY ?? 0,
      packages,
      guides,
      staff,
    },
  };
};

export const acceptBookingService = async (
  agencyId: string,
  // bookingId: string
) => {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { status: true },
  });

  if (!agency) throw new Error("Agency not found");

  if (agency.status === "LOCKED") {
    throw new Error("Agency is locked and cannot accept bookings");
  }

  //need to create "bookings" table
  // const booking = await db.booking.updateMany({
  //   where: {
  //     id: bookingId,
  //     agency_id: agencyId,
  //   },
  //   data: {
  //     status: "ACCEPTED",
  //     updated_at: new Date(),
  //   },
  // });

  // if (booking.count === 0) {
  //   throw new Error("Booking not found");
  // }

  return { success: true };
};


export const publishPackageService = async (
  agencyId: string,
  // packageId: string
) => {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    select: { status: true },
  });

  if (!agency) throw new Error("Agency not found");

  if (agency.status === "LOCKED") {
    throw new Error("Agency is locked and cannot publish packages");
  }

  //Need to create "packages" table
  // const pkg = await db.agency.updateMany({
  //   where: {
  //     id: packageId,
  //     agency_id: agencyId,
  //   },
  //   data: {
  //     is_published: true,
  //     updated_at: new Date(),
  //   },
  // });

  // if (pkg.count === 0) {
  //   throw new Error("Package not found");
  // }

  return { success: true };
};


export const agencySubscription = async (agencyId: string, tierId: string) => {
  const agency = await db.agency.update({
    where: {
      id: agencyId,
    },
    data: {
      status: "ACTIVE",
      tierId: tierId,
    },
  });


  return {
    subscription: agency,
  };
};


interface AgencyInfo {
  logo?: string;
  logoShowOnWebsite?: boolean;

  description?: string;
  descriptionShowOnWebsite?: boolean;

  phone?: string[];
  phoneShowOnWebsite?: boolean;

  email?: string[];
  emailShowOnWebsite?: boolean;

  address?: string;
  addressShowOnWebsite?: boolean;

  regions?: string[];
  regionsShowOnWebsite?: boolean;
};

/** Profile columns that are safe to return — never the Instagram token or other widget secrets. */
const PROFILE_SELECT = {
  logo: true,
  description: true,
  address: true,
  phone: true,
  email: true,
  regions: true,
  logoShowOnWebsite: true,
  descriptionShowOnWebsite: true,
  phoneShowOnWebsite: true,
  emailShowOnWebsite: true,
  regionsShowOnWebsite: true,
  addressShowOnWebsite: true,
  updatedAt: true,
} as const;

const profileError = (message: string) => Object.assign(new Error(message), { status: 400 });

const cleanList = (v: unknown, label: string, maxItems: number, maxLen: number, ok?: (s: string) => boolean): string[] => {
  if (!Array.isArray(v)) throw profileError(`${label} must be a list.`);
  const out = v.map((x) => {
    if (typeof x !== "string") throw profileError(`${label} must be a list of text values.`);
    const t = x.trim();
    if (t.length > maxLen) throw profileError(`${label}: each entry must be at most ${maxLen} characters.`);
    if (/[<>]/.test(t)) throw profileError(`${label} must not contain < or >.`);
    if (ok && !ok(t)) throw profileError(`${label}: "${t}" is not valid.`);
    return t;
  }).filter(Boolean);
  if (out.length > maxItems) throw profileError(`${label}: at most ${maxItems} entries.`);
  return out;
};

const cleanFlag = (v: unknown, label: string): boolean => {
  if (typeof v !== "boolean") throw profileError(`${label} must be true or false.`);
  return v;
};

export const getAgencyProfileService = async (agencyId: string) => {
  const row = await db.agencyProfile.findUnique({ where: { agencyId }, select: PROFILE_SELECT });
  // The row can exist (created by a widget save) with these JSON columns still null.
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  if (row) return { ...row, phone: list(row.phone), email: list(row.email), regions: list(row.regions) };
  return (
    {
      logo: null, description: null, address: null, phone: [], email: [], regions: [],
      logoShowOnWebsite: true, descriptionShowOnWebsite: true, phoneShowOnWebsite: true,
      emailShowOnWebsite: true, regionsShowOnWebsite: true, addressShowOnWebsite: true, updatedAt: null,
    }
  );
};

export const updateAgencyProfileService = async (
  data: AgencyInfo,
  agencyId: string
) => {
  const body = (data ?? {}) as Record<string, unknown>;
  const allowed = new Set([
    "logo", "description", "address", "phone", "email", "regions",
    "logoShowOnWebsite", "descriptionShowOnWebsite", "phoneShowOnWebsite", "emailShowOnWebsite", "regionsShowOnWebsite", "addressShowOnWebsite",
  ]);
  for (const k of Object.keys(body)) if (!allowed.has(k)) throw profileError(`Unknown field: ${k}`);

  const updateData: Record<string, unknown> = {};

  if (body.logo !== undefined) {
    if (body.logo === null || body.logo === "") updateData.logo = null;
    else {
      try {
        const u = new URL(String(body.logo));
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        updateData.logo = u.toString();
      } catch {
        throw profileError("Logo must be an http(s) image URL.");
      }
    }
  }
  for (const [k, max, label] of [["description", 2000, "Description"], ["address", 300, "Address"]] as const) {
    const v = body[k];
    if (v === undefined) continue;
    if (v === null) { updateData[k] = null; continue; }
    if (typeof v !== "string") throw profileError(`${label} must be text.`);
    if (v.trim().length > max) throw profileError(`${label} must be at most ${max} characters.`);
    if (/[<>]/.test(v)) throw profileError(`${label} must not contain < or >.`);
    updateData[k] = v.trim() || null;
  }
  if (body.phone !== undefined) updateData.phone = cleanList(body.phone, "Phone numbers", 5, 25, (s) => /^[+()\d][\d\s()+.-]{5,24}$/.test(s));
  if (body.email !== undefined) updateData.email = cleanList(body.email, "Emails", 5, 254, (s) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(s));
  if (body.regions !== undefined) updateData.regions = cleanList(body.regions, "Regions", 20, 60);

  for (const k of ["logoShowOnWebsite", "descriptionShowOnWebsite", "phoneShowOnWebsite", "emailShowOnWebsite", "addressShowOnWebsite", "regionsShowOnWebsite"] as const) {
    if (body[k] !== undefined) updateData[k] = cleanFlag(body[k], k);
  }

  if (Object.keys(updateData).length === 0) {
    return {
      message: "No fields provided to update",
      data: null,
    };
  }

  const result = await db.agencyProfile.upsert({
    where: { agencyId },
    update: updateData,
    create: { agency: { connect: { id: agencyId } }, ...updateData },
    select: PROFILE_SELECT,
  });

  return {
    message: "Agency profile updated successfully",
    data: result,
  };
};


interface KYCDetails {
  business_registration: string;
  pan_certificate: string;
  tourism_license: string;
  bank_details: string;
}
/** Approved / in-review submissions are not overwritable: re-submitting would swap the reviewed
 * documents and silently drop an approved agency back to "submitted". */
export const assertKycSubmittable = async (agencyId: string) => {
  const current = await db.kycSubmission.findUnique({ where: { agencyId }, select: { status: true } });
  if (current && (current.status === "APPROVED" || current.status === "UNDER_REVIEW")) {
    throw Object.assign(
      new Error(current.status === "APPROVED" ? "Your KYC is already approved." : "Your KYC is under review. You can resubmit only if it is rejected."),
      { status: 409 },
    );
  }
};

export const AgencyKYCService = async (agencyId: string, kycDetails: KYCDetails) => {

  await assertKycSubmittable(agencyId);

  const kyc = await db.kycSubmission.upsert({
    where: { agencyId },
    update: {
      status: "SUBMITTED",
      rejectionReason: null,
      submittedAt: new Date(),
    },
    create: { 
      agencyId,
      status: "SUBMITTED",
    },
  });

  // delete old docs (avoid duplicates)
  await db.kycDocument.deleteMany({
    where: { kycId: kyc.id },
  });

  // Create documents as kycSubmission model takes document instead of singular file
  await db.kycDocument.createMany({
    data: [
      {
        kycId: kyc.id,
        type: "BUSINESS_REGISTRATION",
        fileUrl: kycDetails.business_registration,
      },
      {
        kycId: kyc.id,
        type: "PAN_CERTIFICATE",
        fileUrl: kycDetails.pan_certificate,
      },
      {
        kycId: kyc.id,
        type: "TOURISM_LICENSE",
        fileUrl: kycDetails.tourism_license,
      },
      {
        kycId: kyc.id,
        type: "BANK_DETAILS",
        fileUrl: kycDetails.bank_details,
      },
    ],
  });


  return {
    message: "KYC details submitted successfully. Waiting for Approval.",
  };

};


export const KYCStatusService = async (agencyId: string) => {

  const agency = await db.agency.findUnique({
    where: {
      id: agencyId,
    },
    select: {
      kyc: {
        select: {
          status: true,
          rejectionReason: true,
        },
      },
    },
  });

  if (!agency) {
    throw new Error("Agency not found");
  }

  return {
    agency,
  };

};
