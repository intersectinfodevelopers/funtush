import { validateAcencyInput } from "../utils/validator";
import { db } from "../../../../packages/database/src/db";
import { generateSlug } from "../utils/slug";
import { sendTrialExpiredEmail, sendWelcomeEmail } from "../utils/email";

interface CreateAgencyInput {
  company_name: string;
  email: string;
  password: string;
  phone: string;
  country?: string;
}

export const createAgency = async (data: CreateAgencyInput) => {
  const { company_name, email, password, phone } = data;

  // validation
  validateAcencyInput({ email, password, phone });

  // check duplicate email
  const existing = await db.query(
    "SELECT * FROM AgencyUser WHERE email = $1",
    [email]
  );

  if (existing.rows.length > 0) {
    const error = new Error("Email already exists") as Error & { status?: number };
    error.status = 409;
    throw error;
  }

  // generate unique slug
  const slug = await generateSlug(company_name, db);

  // create agency
  const agencyResult = await db.query(
    "INSERT INTO agency (company_name, slug) VALUES ($1, $2) RETURNING *",
    [company_name, slug]
  );

  const agency = agencyResult.rows[0];

  // create admin user
  await db.query(
    "INSERT INTO AgencyUser (company_id, email, password, role) VALUES ($1, $2, $3, $4)",
    [agency.id, email, password, "admin"]
  );

  // refresh token
  await db.query(
    "INSERT INTO RefreshToken (company_id, token) VALUES ($1, $2)",
    [agency.id, "refresh-token"]
  );

  const trial_expires_at = new Date();
  trial_expires_at.setDate(trial_expires_at.getDate() + 30);

  await db.query(
    "INSERT INTO agency (company_id, tier, trial_expires_at) VALUES ($1, $2, $3)",
    [agency.id, "FREE", trial_expires_at]
  );

  // email after registration
  await sendWelcomeEmail(email, password, company_name);

  return {
    success: true,
    message: "Agency registered successfully",
    data: {
      slug,
    },
  };
};


export const lockExpiredAgencies = async () => {
  const now = new Date();

  // Find expired tiers where status is still active
  const expiredAgencies = await db.query(
    `SELECT * FROM agency WHERE trial_expires_at < $1 AND status = 'ACTIVE'`,
    [now]
  );

  const agencies = expiredAgencies.rows;

  if (agencies.length === 0) return;

  // Lock them
  await db.query(
    `UPDATE agency SET status = 'LOCKED' WHERE trial_expires_at < $1 AND status = 'ACTIVE' RETURNING *`,
    [now]
  );

  // Send warning email
  for (const agency of agencies) {
    await sendTrialExpiredEmail(agency.email, agency.company_name);
  }

};


//TO BE DONE
export const getSubscription = async () => {
  // 
};

export const getAgencyDashboard = async () => {
  // 
};

export const acceptBookings = async () => {
  // 
};

export const publishPackages = async () => {
  // 
};


export const agencySubscription = async (agencyId: string, tier: string) => {
  return await db.query(
    `UPDATE agency
     SET status = 'ACTIVE',
         tier = $1
     WHERE id = $2
     RETURNING *`,
    [tier, agencyId]
  );
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
export const updateAgencyProfileService = async (data: AgencyInfo, agencyId: string) => {
  const fieldMap: Record<string, string> = {
    address: "address",
    addressShowOnWebsite: "address_show_on_website",

    logo: "logo",
    description: "description",
    phone: "phone", /**JSON ARRAY */
    email: "email", /**JSON ARRAY */
    regions: "regions",

    logoShowOnWebsite: "logo_show_on_website",
    descriptionShowOnWebsite: "description_show_on_website",
    phoneShowOnWebsite: "phone_show_on_website",
    emailShowOnWebsite: "email_show_on_website",
    regionsShowOnWebsite: "regions_show_on_website",
  };

  const fields: string[] = [];
  const values: (string | null)[] = [];
  let index = 1;

  let mapsUrl: string | undefined;

  if (data.address !== undefined) {
    mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(
      data.address
    )}&output=embed`;
  }

  for (const key in fieldMap) {
    const value = (data as Record<string, string | null>)[key];

    if (value !== undefined) {
      fields.push(`${fieldMap[key]} = $${index++}`);

      /*
      JSON ARRAY FOR PHONE NUMBERS AND EMAILS
      */
      values.push(Array.isArray(value) ? JSON.stringify(value) : value);
    }
  }


  /** add maps_url if address exists*/
  if (mapsUrl) {
    fields.push(`maps_url = $${index++}`);
    values.push(mapsUrl);
  }

  if (fields.length === 0) {
    return {
      message: "No fields provided to update",
      data: null,
    };
  }

  values.push(agencyId);

  const query = `
    UPDATE agencies
    SET ${fields.join(", ")}, updated_at = NOW()
    WHERE id = $${index}
    RETURNING *
  `;

  const result = await db.query(query, values);

  return {
    message: "Agency profile updated successfully",
    data: result.rows[0],
  };
};


export const updateAgencyDomainService = async (agencyId: string, domain: string) => {
  const result = await db.query(
    `UPDATE agencies
     SET custom_domain = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [domain, agencyId]
  );

  return {
    agency: result.rows[0],
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

  const result = await db.query(
    `
    UPDATE kyc_submissions
    SET
      business_registration = $1,
      pan_certificate = $2,
      tourism_license = $3,
      bank_details = $4,
      status = 'SUBMITTED',
      updated_at = NOW()
    WHERE agency_id = $5
    RETURNING *
    `,
    [
      kycDetails.business_registration,
      kycDetails.pan_certificate,
      kycDetails.tourism_license,
      kycDetails.bank_details,
      agencyId,
    ]
  );

  return {
    agency: result.rows[0],
    message: "KYC details submitted successfully. Waiting for Approval.",
  };

};

