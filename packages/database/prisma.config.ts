import { defineConfig, env } from "prisma/config";
import dotenv from "dotenv";
import path from "path";

console.log("BEFORE dotenv:", process.env.DATABASE_URL);
dotenv.config({ path: path.resolve(__dirname, ".env") });
console.log("AFTER dotenv:", process.env.DATABASE_URL);

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});