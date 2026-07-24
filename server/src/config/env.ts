import dotenv from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

dotenv.config({ path: resolve(import.meta.dirname, "../../../.env") });

const optionalNonEmptyString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  TRUST_PROXY: z.string().toLowerCase().transform((value) => value === "true").default("false"),
  CORS_ORIGINS: z.string().default("http://localhost:5173").transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
  API_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(100_000).default(1_000),
  PIPELINE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  WORKER_POLL_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
  WORKER_LEASE_MS: z.coerce.number().int().min(10_000).max(15 * 60_000).default(60_000),
  RUN_ADS_CALL_BUDGET: z.coerce.number().int().min(1).max(10_000).default(100),
  RUN_GEMINI_CALL_BUDGET: z.coerce.number().int().min(1).max(100_000).default(300),
  RUN_APOLLO_CALL_BUDGET: z.coerce.number().int().min(1).max(100_000).default(1_000),
  AUTH_MODE: z.enum(["development", "password", "trusted_proxy"]).default("development"),
  AUTH_PROXY_SHARED_SECRET: z.string().min(32).optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  SESSION_COOKIE_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default("power_leads_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(168),
  AUTH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1).max(100).default("Administrator"),
  DEV_AUTH_USER_ID: z.string().min(1).default("local-user"),
  DEV_AUTH_WORKSPACE_ID: z.string().min(1).default("local-workspace"),
  DEV_AUTH_ROLE: z.enum(["admin", "operator", "reviewer"]).default("admin"),
  MONGO_URI: z.string().min(1),
  ADS_API_URL: z.string().url(),
  ADS_API_TOKEN: z.string().min(1),
  ADS_API_MODE: z.enum(["mock", "live"]).default("mock"),
  ADS_API_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(10),
  APOLLO_API_KEY: z.string().min(1),
  APOLLO_MODE: z.enum(["mock", "live"]).default("mock"),
  APOLLO_BASE_URL: z.string().url().default("https://api.apollo.io/api/v1"),
  APOLLO_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  APOLLO_CONTACTS_PER_COMPANY: z.coerce.number().int().min(1).max(20).default(3),
  APOLLO_REQUIRE_VERIFIED_EMAIL: z.string().toLowerCase().transform((value) => value === "true").default("true"),
  APOLLO_REVEAL_PERSONAL_EMAILS: z.string().toLowerCase().transform((value) => value === "true").default("true"),
  APOLLO_WEBHOOK_URL: z.string().url().optional(),
  APOLLO_WEBHOOK_SECRET: z.string().min(24).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODE: z.enum(["mock", "live"]).default("mock"),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash"),
  GEMINI_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  MAIL_MODE: z.enum(["mock", "live"]).default("mock"),
  SENDGRID_API_KEY: z.string().min(1).optional(),
  SENDGRID_FROM_EMAIL: z.string().email().optional(),
  SENDGRID_FROM_NAME: z.string().min(1).max(100).default("Power Leads"),
  SENDGRID_WEBHOOK_PUBLIC_KEY: optionalNonEmptyString,
  SENDGRID_WEBHOOK_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  MAIL_PER_RUN_LIMIT: z.coerce.number().int().min(1).max(10_000).default(50),
  MAIL_DAILY_WORKSPACE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(100),
  MAIL_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3)
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.AUTH_MODE === "development") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_MODE"], message: "Production cannot use development authentication" });
  }
  if (value.NODE_ENV === "production" && value.CORS_ORIGINS.includes("*")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGINS"], message: "Production CORS cannot allow every origin" });
  }
  if (value.AUTH_MODE === "trusted_proxy" && !value.AUTH_PROXY_SHARED_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["AUTH_PROXY_SHARED_SECRET"], message: "Required for trusted_proxy authentication" });
  }
  if (value.GEMINI_MODE === "live" && !value.GEMINI_API_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["GEMINI_API_KEY"], message: "Required when GEMINI_MODE=live" });
  }
  if (value.APOLLO_WEBHOOK_URL && !value.APOLLO_WEBHOOK_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APOLLO_WEBHOOK_SECRET"], message: "Required when Apollo mobile enrichment webhook is enabled" });
  }
  if (value.APOLLO_WEBHOOK_URL && value.APOLLO_WEBHOOK_SECRET && new URL(value.APOLLO_WEBHOOK_URL).searchParams.get("token") !== value.APOLLO_WEBHOOK_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["APOLLO_WEBHOOK_URL"], message: "Apollo webhook URL must contain a token query parameter matching APOLLO_WEBHOOK_SECRET" });
  }
  if (value.MAIL_MODE === "live" && !value.SENDGRID_API_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["SENDGRID_API_KEY"], message: "Required when MAIL_MODE=live" });
  }
  if (value.MAIL_MODE === "live" && !value.SENDGRID_FROM_EMAIL) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["SENDGRID_FROM_EMAIL"], message: "A verified sender is required when MAIL_MODE=live" });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid server environment configuration: ${missing}`);
}

export const env = parsed.data;
