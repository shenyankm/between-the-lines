import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";
export default tseslint.config(
  { ignores: ["dist", "src/generated", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": hooks },
    rules: hooks.configs.recommended.rules,
  },
  jsxA11y.flatConfigs.recommended,
  {
    // Plain JS files (this config) live outside every tsconfig project, so
    // type-aware linting cannot run on them; keep them syntax-checked only.
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
