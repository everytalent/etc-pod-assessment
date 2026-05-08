import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
    globals: false,
    env: {
      // engine.ts imports the DB client at module load. The pure tests never
      // hit the DB (postgres-js is lazy — no connect until a query runs), but
      // the env-var guard fires at import time. Provide a sentinel URL so
      // module load succeeds; any DB-bound test will need its own setup.
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
});
