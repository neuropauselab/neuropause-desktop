import { z } from 'zod';

/**
 * Validates process.env at boot. The server refuses to start with a malformed
 * configuration rather than failing mysteriously at runtime.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_BACKEND_URL: z.string().url().default('http://127.0.0.1:4000'),

  // When "false", the server does NOT migrate on boot (e.g. Kubernetes runs the
  // one-off migrate Job instead, so multiple replicas don't race). Default keeps
  // single-instance / compose deploys one command away.
  RUN_MIGRATIONS_ON_BOOT: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  // When "false", the boot path does NOT seed the demo store catalog. Default true
  // keeps a fresh dev checkout populated; production deployments set it false so the
  // catalog starts empty (no fabricated apps / ratings / download counts).
  SEED_STORE_ON_BOOT: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT: z.string().default('common'),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),

  // Optional operational alerting: when ALERT_WEBHOOK_URL is set, dependency
  // health transitions (up<->down) are POSTed to it as generic JSON (with a
  // human-readable `text` summary that renders in Slack/Discord-style webhooks).
  // Unset by default — alerting stays log + Prometheus-metric only until an
  // operator opts in. The URL is validated at boot.
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ALERT_WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  // Billing (Razorpay). All optional — billing is disabled until these are set.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  RAZORPAY_PLAN_STARTER: z.string().optional(),
  RAZORPAY_PLAN_PROFESSIONAL: z.string().optional(),
  RAZORPAY_PLAN_ENTERPRISE: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const env = new Proxy({} as Env, {
  get: (_t, prop: string) => loadEnv()[prop as keyof Env],
});
