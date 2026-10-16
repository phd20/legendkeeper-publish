import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "esbuild.config.mjs", "vitest.config.ts"] },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", { brands: ["LegendKeeper", "LK"], ignoreWords: ["Markdown"] }],
    },
  },
  {
    // display() is the only settings API on Obsidian 1.11.4–1.12; getSettingDefinitions needs 1.13.
    files: ["src/settings/tab.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
]);
