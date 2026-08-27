import { nestConfig } from '@repo/eslint-config/nest';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nestConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
