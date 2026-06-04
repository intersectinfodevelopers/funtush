// Root flat config. ESLint walks up from each workspace package and resolves
// this file; the actual rule set lives in the shared @funtush/config package.
import preset from "@funtush/config/eslint";

export default preset;
