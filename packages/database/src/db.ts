// import { Pool } from "pg";

// export const db = new Pool({
//   connectionString: process.env.DATABASE_URL,
// });

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Lightweight compatibility wrapper to match a simple `db.query(text, params)`
// API used by parts of the codebase. Internally maps to Prisma's
// `$queryRawUnsafe` and returns an object with a `rows` array to mimic
// `pg` Pool behaviour.
export const db = {
	query: async (text: string, values: readonly unknown[] = []) => {
		const result = await prisma.$queryRawUnsafe(text, ...values);
		// Prisma returns results directly as arrays/objects — wrap as { rows }
		return { rows: Array.isArray(result) ? result : [result] };
	},
};