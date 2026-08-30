import { defineConfig, env } from "prisma/config";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

console.log("DATABASE_URL =", process.env.DATABASE_URL);

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
