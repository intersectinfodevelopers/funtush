import Redis from "ioredis";

const RedisConstructor = Redis as unknown as new (connectionUrl: string) => any;

export const redis = new RedisConstructor(
	process.env.REDIS_URL ?? "redis://localhost:6379"
);