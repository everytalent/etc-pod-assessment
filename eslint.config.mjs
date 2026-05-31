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
    // Node-only helper scripts (run via tsx, not part of the Next.js
    // app). They use Node globals like __dirname that the Next ESLint
    // config doesn't expect.
    "scripts/**",
    // SQL + Drizzle migrations — not JS/TS.
    "drizzle/**",
  ]),
]);

export default eslintConfig;
