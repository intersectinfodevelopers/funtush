import { generateSlug } from "../utils/slug";
import { sendTrialExpiredEmail, sendWelcomeEmail } from "../utils/email";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { db } from "@funtush/database";
import { validateRegistrationInput } from "../utils/validator";


interface CreateAgencyInput {
  name: string;
  email: string;
  password: string;
  phone: string;
  country?: string;
}

export const createAgency = async (data: CreateAgencyInput) => {
  const { name, email, password, phone } = data;

  // validation
  validateRegistrationInput({ email, password, phone });

  // check duplicate email
  const existing = await db.agencyUser.findUnique(
    { where: { email }, }
  );

  if (existing) {
    const error = new Error("Email already exists") as Error & { status?: number };
    error.status = 409;
    throw error;
  }

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


  // create agency
  const agency = await db.agency.create({
    data: {
      name,
      email,
      slug,
      status: "ACTIVE",
      trialExpiresAt,

      tier: {
        connect: {
          name: "FREE",
        },
      },
    },
  });


  // create admin user
  const user = await db.agencyUser.create({
    data: {
      agencyId: agency.id,
      email,
      passwordHash: hashedPassword,
      role: "AGENCY_ADMIN",
    },
  });

  const refreshToken = await db.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
    },
  });


  // email after registration
  await sendWelcomeEmail(email, password, name);

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
};



export const lockExpiredAgencies = async () => {
  const now = new Date();

  // Find expired tiers where status is still active
  const agencies = await db.agency.findMany({
    where: {
      trial_expires_at: {
        lt: now,
      },
      status: "ACTIVE",
    },
    select: {
      id: true,
      email: true,
      name: true,
    },
  });


  if (agencies.length === 0) return;

  // Lock them
  await db.agency.updateMany({
    where: {
      trial_expires_at: {
        lt: now,
      },
      status: "ACTIVE",
    },
    data: {
      status: "LOCKED",
    },
  });

  // Send warning email
  for (const agency of agencies) {
    await sendTrialExpiredEmail(agency.email, agency.name);
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


export const getAgencyDashboardService = async (agencyId: string) => {
  const agency = await db.agency.findUnique({
    where: { id: agencyId },
    include: {
      tier: true,
      users: true,
      profile: true,
      kyc: true,
      subscriptions: {
        orderBy: { createdAt: "desc" },
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

export const updateAgencyProfileService = async (
  data: AgencyInfo,
  agencyId: string
) => {
  const updateData: Record<string, unknown> = {};

  // helper to safely store JSON in Prisma
  const toJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  let maps_url: string | undefined;

  // Build Google Maps URL
  if (data.address) {
    maps_url = `https://www.google.com/maps?q=${encodeURIComponent(
      data.address
    )}&output=embed`;
  }

  // Map fields to db format (camelCase)
  if (data.logo !== undefined) updateData.logo = data.logo;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.address !== undefined) updateData.address = data.address;

  // JSON fields
  if (data.phone !== undefined) updateData.phone = toJson(data.phone);
  if (data.email !== undefined) updateData.email = toJson(data.email);
  if (data.regions !== undefined) updateData.regions = toJson(data.regions);

  // Show-on-website flags
  if (data.logoShowOnWebsite !== undefined)
    updateData.logoShowOnWebsite = data.logoShowOnWebsite;

  if (data.descriptionShowOnWebsite !== undefined)
    updateData.descriptionShowOnWebsite = data.descriptionShowOnWebsite;

  if (data.phoneShowOnWebsite !== undefined)
    updateData.phoneShowOnWebsite = data.phoneShowOnWebsite;

  if (data.emailShowOnWebsite !== undefined)
    updateData.emailShowOnWebsite = data.emailShowOnWebsite;

  if (data.addressShowOnWebsite !== undefined)
    updateData.addressShowOnWebsite = data.addressShowOnWebsite;

  if (data.regionsShowOnWebsite !== undefined)
    updateData.regionsShowOnWebsite = data.regionsShowOnWebsite;


  // Add maps URL if address exists
  if (maps_url) {
    updateData.mapsUrl = maps_url;
  }

  if (Object.keys(updateData).length === 0) {
    return {
      message: "No fields provided to update",
      data: null,
    };
  }

  console.log("agencyId:", agencyId);
  console.log("updateData:", updateData);

  // await db.agency.update({
  //   where: { id: agencyId },
  //   data: {
  //     maps_url,
  //   }
  // });

  const result = await db.agencyProfile.upsert({
    where: {
      agencyId: agencyId,
    },

    update: {
      ...updateData,
      // mapsUrl: maps_url,
    },

    create: {
      agency: {
        connect: {
          id: agencyId,
        },
      },

      ...updateData,
      // mapsUrl: maps_url,
    },
  });

  return {
    message: "Agency profile updated successfully",
    data: result,
  };
};


export const updateAgencyDomainService = async (agencyId: string, domain: string) => {
  const updatedAgency = await db.agency.update({
    where: {
      id: agencyId,
    },
    data: {
      customDomain: domain,
    },
  });

  return {
    updatedAgency,
    dnsInstructions: {
      step1: `Add CNAME record: ${domain} → your-app.com`,
      step2: `Wait for propagation (5-30 min)`,
      step3: `Verify domain in dashboard`,
    },
  };

};


interface KYCDetails {
  business_registration: string;
  pan_certificate: string;
  tourism_license: string;
  bank_details: string;
}
export const AgencyKYCService = async (agencyId: string, kycDetails: KYCDetails) => {

  const kyc = await db.kycSubmission.upsert({
    where: { agencyId },
    update: {
      status: "SUBMITTED",
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
