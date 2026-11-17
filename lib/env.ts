/**
 * Server-only environment. Read lazily so importing this module never throws
 * at build time; each getter throws a clear error if the value is missing.
 *
 * Never import this from a client component.
 */
import { z } from "zod";

if (typeof window !== "undefined") {
  throw new Error("lib/env.ts is server-only");
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  STORAGE_BUCKET: z.string().min(1).default("inspection-media"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().optional().default(""),
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .default("http://localhost:3000")
    .transform((s) => s.replace(/\/+$/, "")),
  CLIP_PAD_BEFORE_MS: z.coerce.number().int().nonnegative().default(3000),
  CLIP_PAD_AFTER_MS: z.coerce.number().int().nonnegative().default(3000),
  MAX_AUTO_CLIP_MS: z.coerce.number().int().positive().default(20000),
  MAX_RECORDING_MS: z.coerce.number().int().positive().default(600000),
  ENABLE_REPROCESS: z
    .string()
    .optional()
    .transform((s) => s === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment (check .env.local): ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
