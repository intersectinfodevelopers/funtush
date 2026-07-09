import { reindexAll } from "../services/search.service";

reindexAll()
  .then((result) => {
    console.log("Reindex complete:", result);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Reindex failed:", err);
    process.exit(1);
  });