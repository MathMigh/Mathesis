import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "data/**",
    "work/**",
    "tmp/**",
    "node_modules/**",
    "public/validation/**",
    "next-env.d.ts",
    "tmp_*.js",
    "tmp_*.ts",
  ]),
]);

export default eslintConfig;
