import { createClient, type RedisClientType } from "redis";

export function getRedisUrl() {
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error("REDIS_URL is not defined in environment variables");
  }

  return url;
}

let redisClient: RedisClientType | null = null;
let connectPromise: Promise<RedisClientType> | null = null;

export async function getRedis() {
  if (!redisClient) {
    redisClient = createClient({
      url: getRedisUrl(),
    });

    redisClient.on("error", (err) => {
      console.error("Redis Error:", err);
    });

    redisClient.on("connect", () => {
      console.log("Redis connected successfully");
    });
  }

  if (!connectPromise) {
    connectPromise = redisClient.connect().then(() => redisClient!);
  }

  await connectPromise;

  return redisClient!;
}