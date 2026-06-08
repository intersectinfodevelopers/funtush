try {
  const dotenv = require("dotenv");
  dotenv.config();
} catch {
  // Do nothing if dotenv is not installed
}

export const env = {
  REDIS_URL: process.env.REDIS_URL!,
};