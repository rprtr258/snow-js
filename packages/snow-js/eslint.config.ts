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
    // effects/noita/ uses a lighter ruleset below.
    files: ["**/*.ts", "*.ts"],
    ignores: ["effects/noita/**"],
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
    ignores: ["effects/noita/**"],
  })),
  {
    files: ["**/*.ts", "*.ts"],
    ignores: ["effects/noita/**"],
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
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.property.name='forEach']",
        message: "forEach is prohibited. Use for..of or functional methods with value return.",
      }, {
        selector: "TSInterfaceDeclaration",
        message: "interface is prohibited; use a type alias.",
      }],
    },
  },
  {
    // noita: the ported sources are strictly typed, so an explicit `any` is a
    // lint error; this is the only rule noita enforces for now.
    files: ["effects/noita/src/**/*.ts", "effects/noita/scripts/**/*.ts"],
    plugins: {"@typescript-eslint": tseslint.plugin},
    languageOptions: {parser: tseslint.parser},
    rules: {"@typescript-eslint/no-explicit-any": "error"},
  },
]);
