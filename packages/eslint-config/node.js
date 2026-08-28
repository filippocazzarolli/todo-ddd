import tseslint from "typescript-eslint";
import globals from "globals";
import { config as baseConfig } from "./base.js";

/**
 * A custom ESLint configuration for server-side TypeScript packages that are
 * not Nest applications.
 *
 * Differs from `nestConfig` in two deliberate ways: no jest globals (a package
 * that has tests declares them itself), and `no-explicit-any` stays on — these
 * packages are where ORM and driver types are handled, which is exactly where
 * severity is worth keeping.
 *
 * Type-aware linting requires the consuming package to supply
 * `parserOptions.projectService` / `tsconfigRootDir`.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const nodeConfig = [
  ...baseConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "commonjs",
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "eslint.config.mjs"],
  },
];
