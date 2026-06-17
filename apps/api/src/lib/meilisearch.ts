import { Meilisearch } from "meilisearch";

/**
 * Single shared Meilisearch client (Backend Guide §14: search is answered ONLY
 * by Meilisearch, never by Postgres). Mirrors the singleton pattern used by
 * lib/redis.ts — one instance per process.
 *
 * Configuration comes from the environment:
 *   MEILI_HOST       — base URL of the Meilisearch server (default: localhost:7700)
 *   MEILI_MASTER_KEY — admin API key used for indexing + settings (optional in dev)
 *
 * In local dev Meilisearch can run without a master key, so the key is optional.
 * In every other environment it MUST be set, or write operations are rejected.
 */
const MEILI_HOST = process.env.MEILI_HOST ?? "http://localhost:7700";
const MEILI_MASTER_KEY = process.env.MEILI_MASTER_KEY ?? undefined;

// The Meilisearch export can resolve to a module namespace rather than a
// constructable class under some CJS/ESM interop configs (the same issue the
// ioredis client hits in db.ts). Normalize to a constructor at runtime.
const MeilisearchCtor = Meilisearch as unknown as new (config: {
  host: string;
  apiKey?: string;
}) => Meilisearch;

let client: Meilisearch | null = null;

/**
 * Lazily build (and reuse) the client. Lazy on purpose: importing the search
 * service must not open a connection — that keeps unit tests that never touch
 * search from constructing a real client.
 */
export function getMeili(): Meilisearch {
  if (!client) {
    client = new MeilisearchCtor({ host: MEILI_HOST, apiKey: MEILI_MASTER_KEY });
  }
  return client;
}

/**
 * Returns true when a Meilisearch host is configured. Used by the search
 * service to no-op (instead of throwing) when search is not wired up — the
 * rest of the API keeps working even if the search box is temporarily down.
 */
export function isSearchEnabled(): boolean {
  return Boolean(MEILI_HOST);
}
