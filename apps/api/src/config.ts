import { z } from "zod";
import { readFileSync } from "node:fs";

const boolean = z.stringbool().default(false);
const optional = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const schema = z.object({
  APP_NAME: z.string().default("ServicePilot AI"),
  APP_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_VERSION: z.string().default("0.2.0"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // shipproof-ignore SP109
  WEB_ORIGIN: z.string().default("http://localhost:3000"),

  AI_MODE: z.enum(["local", "openai"]).default("local"),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh"]).default("low"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(0),
  AI_FALLBACK_ON_ERROR: boolean,

  PERSISTENCE_MODE: z.enum(["memory", "postgres"]).default("memory"),
  DATABASE_URL: optional,
  EMBEDDING_PROVIDER: z.enum(["hash", "openai"]).default("hash"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(3_072).default(384),
  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.28),

  AUTH_MODE: z.enum(["local", "jwt"]).default("local"),
  JWT_SECRET: optional,
  JWT_ISSUER: z.string().default("servicepilot"),
  JWT_AUDIENCE: z.string().default("servicepilot-api"),
  JWT_LEEWAY_SECONDS: z.coerce.number().int().min(0).max(300).default(15),

  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  RATE_LIMIT_REQUESTS: z.coerce.number().int().min(1).max(10_000).default(60),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(60),
  REDIS_URL: optional,
  WEBHOOK_SECRET: optional,

  OTEL_ENABLED: boolean,
  OTEL_SERVICE_NAME: z.string().default("servicepilot-api"),
  OTEL_EXPORTER_OTLP_ENDPOINT: optional,
}).superRefine((env, context) => {
  const require = (value: unknown, path: keyof typeof env) => {
    if (!value) context.addIssue({ code: "custom", path: [path], message: `${path} is required` });
  };

  if (env.AUTH_MODE === "jwt") require(env.JWT_SECRET, "JWT_SECRET");
  if (env.AI_MODE === "openai" || env.EMBEDDING_PROVIDER === "openai") {
    require(env.OPENAI_API_KEY, "OPENAI_API_KEY");
  }
  if (env.PERSISTENCE_MODE === "postgres") require(env.DATABASE_URL, "DATABASE_URL");
  if (env.APP_ENV === "production") {
    if (env.AUTH_MODE !== "jwt") context.addIssue({ code: "custom", path: ["AUTH_MODE"], message: "AUTH_MODE=jwt is required in production" });
    if (env.PERSISTENCE_MODE !== "postgres") context.addIssue({ code: "custom", path: ["PERSISTENCE_MODE"], message: "PERSISTENCE_MODE=postgres is required in production" });
    if (env.AI_MODE !== "openai") context.addIssue({ code: "custom", path: ["AI_MODE"], message: "AI_MODE=openai is required in production" });
    if (env.AI_FALLBACK_ON_ERROR) context.addIssue({ code: "custom", path: ["AI_FALLBACK_ON_ERROR"], message: "AI fallback must be disabled in production" });
    require(env.REDIS_URL, "REDIS_URL");
    require(env.WEBHOOK_SECRET, "WEBHOOK_SECRET");
  }
});

export type Settings = z.infer<typeof schema>;

const secretKeys = ["OPENAI_API_KEY", "DATABASE_URL", "JWT_SECRET", "WEBHOOK_SECRET"] as const;

function withFileSecrets(source: NodeJS.ProcessEnv) {
  const resolved = { ...source };
  for (const key of secretKeys) {
    if (resolved[key]) continue;
    const file = resolved[`${key}_FILE`];
    if (file) resolved[key] = readFileSync(file, "utf8").trim();
  }
  return resolved;
}

export function loadSettings(source: NodeJS.ProcessEnv = process.env): Settings {
  return schema.parse(withFileSecrets(source));
}
