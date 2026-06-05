// import { Pool } from "pg";

// export const db = new Pool({
//   connectionString: process.env.DATABASE_URL,
// });

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();