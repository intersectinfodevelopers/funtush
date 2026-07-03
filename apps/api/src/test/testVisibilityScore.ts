import { recalculateAllVisibilityScores } from "../services/visibility.service";

recalculateAllVisibilityScores()
  .then(() => {
    console.log("Manual test run complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Manual test run failed:", err);
    process.exit(1);
  });