import { nodeConfig } from '@repo/eslint-config/node';

export default [
  ...nodeConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
