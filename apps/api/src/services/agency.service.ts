import { validateAcencyInput } from "../utils/validator";
import { db } from "../../../../packages/database/src/db";
import { generateSlug } from "../utils/slug";
import { sendWelcomeEmail } from "../utils/email";


export const createAgency = async (data: any) => {
  const { company_name, email, password, phone, country } = data;

  // validation
  validateAcencyInput({ email, password, phone });

  // check duplicate email
  const existing = await db.query(
    "SELECT * FROM AgencyUser WHERE email = $1",
    [email]
  );

  if (existing.rows.length > 0) {
    const error: any = new Error("Email already exists");
    error.status = 409;
    throw error;
  }

  // generate unique slug
  let slug = await generateSlug(company_name, db);

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

  // email after registration
  await sendWelcomeEmail(email, password, company_name);

  return {
    message: "agency registered successfully",
    slug,
  };
};