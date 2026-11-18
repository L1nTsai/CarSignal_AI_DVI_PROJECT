// Database tests (plan §14). Needs the local Supabase running and .env.local.
// Run with `npm run test:db`. Each test rolls back, so local data is untouched.
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: {
    include: ["**/*.db.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    environment: "node",
    // One connection pool, tests touch shared tables: run files in sequence.
    fileParallelism: false,
  },
});
