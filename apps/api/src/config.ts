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

	AI_MODE: z.enum(["local", "openai", "gemini", "groq"]).default("local"),
	OPENAI_API_KEY: optional,
	OPENAI_MODEL: z.string().default("gpt-5.6-luna"),
	OPENAI_REASONING_EFFORT: z.enum(["none", "low", "medium", "high", "xhigh"]).default("low"),
	OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
	OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(0),
	GEMINI_API_KEY: optional,
	GEMINI_MODEL: z.string().default("gemini-flash-latest"),
	GROQ_API_KEY: optional,
	GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
	AI_FALLBACK_ON_ERROR: boolean,
	AI_EXTERNAL_EGRESS_ALLOWED: boolean,
	AI_MAX_INPUT_CHARS: z.coerce.number().int().min(1_000).max(100_000).default(32_000),
	AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4_096).default(1_000),
	AI_PROVIDER_RPM: z.coerce.number().int().min(1).max(100_000).default(60),
	AI_PROVIDER_TPM: z.coerce.number().int().min(1_000).max(10_000_000).default(120_000),

	PERSISTENCE_MODE: z.enum(["memory", "postgres"]).default("memory"),
	DATABASE_URL: optional,
	EMBEDDING_PROVIDER: z.enum(["hash", "openai"]).default("hash"),
	EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
	EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(3_072).default(384),
	RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.28),

	AUTH_MODE: z.enum(["local", "jwt", "oidc"]).default("local"),
	JWT_SECRET: optional,
	JWT_SECRET_PREVIOUS: optional,
	JWT_ISSUER: z.string().default("servicepilot"),
	JWT_AUDIENCE: z.string().default("servicepilot-api"),
	JWT_LEEWAY_SECONDS: z.coerce.number().int().min(0).max(300).default(15),
	OIDC_ISSUER_URL: optional,
	OIDC_AUDIENCE: optional,
	OIDC_JWKS_URL: optional,
	AUTH_TENANT_CLAIM: z.string().trim().min(1).max(80).default("tenant_id"),
	AUTH_ROLE_CLAIM: z.string().trim().min(1).max(80).default("roles"),
	AUTH_CUSTOMER_ROLE: z.string().trim().min(1).max(80).default("customer"),
	AUTH_ADMIN_ROLES: z.string().trim().min(1).default("agent,approver,supervisor,audit:read,admin"),
	AUTH_MFA_CLAIM: z.enum(["amr", "acr"]).default("amr"),
	AUTH_MFA_VALUES: z.string().trim().min(1).default("mfa,otp,webauthn"),
	AUTH_REQUIRE_MFA: boolean,

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
	if (env.AUTH_MODE === "oidc") {
		require(env.OIDC_ISSUER_URL, "OIDC_ISSUER_URL");
		require(env.OIDC_AUDIENCE, "OIDC_AUDIENCE");
		require(env.OIDC_JWKS_URL, "OIDC_JWKS_URL");
	}
	if (env.AI_MODE === "openai" || env.EMBEDDING_PROVIDER === "openai") {
		require(env.OPENAI_API_KEY, "OPENAI_API_KEY");
	}
	if (env.AI_MODE === "gemini") {
		require(env.GEMINI_API_KEY || env.OPENAI_API_KEY, "GEMINI_API_KEY");
	}
	if (env.AI_MODE === "groq") require(env.GROQ_API_KEY, "GROQ_API_KEY");
	if (env.AI_MODE !== "local" && !env.AI_EXTERNAL_EGRESS_ALLOWED) context.addIssue({ code: "custom", path: ["AI_EXTERNAL_EGRESS_ALLOWED"], message: "Explicit AI data egress approval is required for external providers" });
	if (env.PERSISTENCE_MODE === "postgres") require(env.DATABASE_URL, "DATABASE_URL");
	if (env.APP_ENV === "production") {
		if (env.AUTH_MODE !== "oidc") context.addIssue({ code: "custom", path: ["AUTH_MODE"], message: "AUTH_MODE=oidc is required in production" });
		if (env.PERSISTENCE_MODE !== "postgres") context.addIssue({ code: "custom", path: ["PERSISTENCE_MODE"], message: "PERSISTENCE_MODE=postgres is required in production" });
		if (env.AI_MODE !== "openai" && env.AI_MODE !== "groq") context.addIssue({ code: "custom", path: ["AI_MODE"], message: "AI_MODE=openai or AI_MODE=groq is required in production" });
		if (env.AI_FALLBACK_ON_ERROR) context.addIssue({ code: "custom", path: ["AI_FALLBACK_ON_ERROR"], message: "AI fallback must be disabled in production" });
		require(env.REDIS_URL, "REDIS_URL");
		require(env.WEBHOOK_SECRET, "WEBHOOK_SECRET");
		if (!env.AUTH_REQUIRE_MFA) context.addIssue({ code: "custom", path: ["AUTH_REQUIRE_MFA"], message: "AUTH_REQUIRE_MFA=true is required in production" });
		for (const [name, value] of [["OIDC_ISSUER_URL", env.OIDC_ISSUER_URL], ["OIDC_JWKS_URL", env.OIDC_JWKS_URL]] as const) {
			try { if (new URL(value ?? "").protocol !== "https:") context.addIssue({ code: "custom", path: [name], message: `${name} must use HTTPS in production` }); }
			catch { context.addIssue({ code: "custom", path: [name], message: `${name} must be a valid URL` }); }
		}
	}
});

export type Settings = z.infer<typeof schema>;

const secretKeys = ["OPENAI_API_KEY", "GROQ_API_KEY", "DATABASE_URL", "JWT_SECRET", "JWT_SECRET_PREVIOUS", "WEBHOOK_SECRET"] as const;

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
