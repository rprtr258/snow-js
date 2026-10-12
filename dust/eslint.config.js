// ESLint flat config. The ported sources are strictly typed, so an explicit
// `any` is a lint error; this is the only rule dust enforces for now.
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/", "node_modules/"] },
  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: { parser: tseslint.parser },
    rules: { "@typescript-eslint/no-explicit-any": "error" },
  },
];
