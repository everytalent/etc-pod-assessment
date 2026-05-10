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
    "next-env.d.ts",
    // Netlify build output — `netlify deploy --build` emits Edge Function
    // vendor bundles (Deno-typed) into .netlify/. Generated, third-party,
    // not ours to lint.
    ".netlify/**",
    "deno.lock",
  ]),
]);

export default eslintConfig;
