import { db } from "@funtush/database/src/db";

export const approveAgencyKYCService = async (
  agencyId: string
) => {
  const result = await db.query(
    `
    UPDATE kyc_submissions
    SET
      status = 'APPROVED',
      reviewed_at = NOW(),
      rejection_reason = NULL
    WHERE agency_id = $1
    RETURNING *
    `,
    [agencyId]
  );

  return {
    kyc: result.rows[0],
    message: "KYC approved successfully",
  };
};


export const rejectAgencyKYCService = async (
  agencyId: string,
  reason: string
) => {
  const result = await db.query(
    `
    UPDATE kyc_submissions
    SET
      status = 'REJECTED',
      rejection_reason = $1,
      reviewed_at = NOW()
    WHERE agency_id = $2
    RETURNING *
    `,
    [reason, agencyId]
  );

  return {
    kyc: result.rows[0],
    message: "KYC rejected",
  };
};