import { createClient } from "redis";
import type { RedisClientType } from "redis";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is not defined in environment variables");
}

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis Error:", err);
});

redisClient.on("connect", () => {
  console.log("Redis connected successfully");
});

let connectPromise: Promise<RedisClientType> | null = null;

export async function getRedis() {
  if (!connectPromise) {
    connectPromise = redisClient.connect().catch((err) => {
      connectPromise = null;
      throw err;
    });
  }

  await connectPromise;
  return redisClient;
}