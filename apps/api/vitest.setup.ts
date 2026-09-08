import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

// Prefer the committed test env (points at docker-compose.test.yml). Fall back to
// a local .env, then to packages/database/.env, so existing setups keep working.
if (existsSync(".env.test")) {
  config({ path: ".env.test" });
} else if (existsSync(".env")) {
  config();
} else {
  config({ path: path.resolve(__dirname, "../../packages/database/.env") });
}

process.env.NODE_ENV ||= "test";
