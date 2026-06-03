import Redis from "ioredis";

const redis = new Redis();

export async function redisGet(key: string) {
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

export async function redisSet(key: string, value: any, ttl: number) {
  await redis.set(key, JSON.stringify(value), "EX", ttl);
}