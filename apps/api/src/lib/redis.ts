import Redis from "ioredis";

<<<<<<< HEAD
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  lazyConnect: true,
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on("error", (err) => {
  console.error("[Redis] Connection error:", err.message);
});

export default redis;
export { redis };
=======
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

export default redis;
export { redis };
>>>>>>> ed8e877
