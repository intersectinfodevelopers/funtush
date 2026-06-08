import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    },
    // Apply to all TS/JS files in all packages
    {
        files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
        },
    }
);