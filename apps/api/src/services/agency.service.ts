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