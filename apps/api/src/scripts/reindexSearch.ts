/**
 * One-off bootstrap / repair script for the Meilisearch indexes.
 *
 * Run after first configuring Meilisearch, or any time the index has drifted
 * from the database:
 *
 *   pnpm --filter @funtush/api search:reindex
 *
 * It (re)creates the indexes with their settings and pushes every PUBLISHED
 * package and every agency. Safe to run repeatedly — Meilisearch upserts by id.
 */
import "dotenv/config";
import { reindexAll } from "../services/search.service.js";

reindexAll()
  .then((counts) => {
    console.log(`Reindex complete: ${counts.packages} packages, ${counts.agencies} agencies`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Reindex failed:", err);
    process.exit(1);
  });
