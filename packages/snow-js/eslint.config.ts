import {defineConfig} from "eslint/config"; // eslint-disable-line
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import importPlugin from "eslint-plugin-import";

export default defineConfig([
  {
    ignores: ["**/dist/", "**/node_modules/"],
  },
  {
    // snow-js sources: strict house style, type-checked against tsconfig.json.
    // dust/ is a separate strict project (tsconfig.dust.json) with its own
    // lighter ruleset below.
    files: ["**/*.ts", "*.ts"],
    ignores: ["dust/**"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        project: ["./tsconfig.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    ignores: ["dust/**"],
  })),
  {
    files: ["**/*.ts", "*.ts"],
    ignores: ["dust/**"],
    plugins: {
      "@stylistic": stylistic,
      import: importPlugin,
    },
    rules: {
      "object-curly-spacing": ["error", "never"],
      "semi": ["error", "always"],
      "comma-dangle": ["error", "always-multiline"],
      "@stylistic/semi": ["error", "always"],
      "@stylistic/member-delimiter-style": ["error", {
        "multiline": {delimiter: "comma", requireLast: true},
        "singleline": {delimiter: "comma", requireLast: false},
      }],
      "import/extensions": ["error", "always"],
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
      }],
      "@typescript-eslint/strict-boolean-expressions": ["error", {
        allowNumber: false,
        allowString: false,
      }],
      "@typescript-eslint/consistent-type-assertions": ["error", {
        assertionStyle: "never",
      }],
    },
  },
  {
    // dust: the ported sources are strictly typed, so an explicit `any` is a
    // lint error; this is the only rule dust enforces for now.
    files: ["dust/src/**/*.ts", "dust/scripts/**/*.ts"],
    plugins: {"@typescript-eslint": tseslint.plugin},
    languageOptions: {parser: tseslint.parser},
    rules: {"@typescript-eslint/no-explicit-any": "error"},
  },
]);
