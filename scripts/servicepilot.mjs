#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  console.error(`\nServicePilot: ${message}`);
  process.exitCode = 1;
}

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] ?? fallback;
}

function hasOption(args, name) {
  return args.includes(name);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
}

function runOutput(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  return result.stdout;
}

function compose(args, env = process.env) {
  run("docker", ["compose", "--project-directory", root, ...args], env);
}

function requiredFile(file, message) {
  const absolute = path.resolve(root, file);
  if (!existsSync(absolute) || statSync(absolute).size === 0) throw new Error(message ?? `Missing ${file}`);
}

function runApiChecks() {
  const api = path.join(root, "apps", "api");
  const checks = [
    ["typecheck", "API typecheck"],
    ["test", "API tests"],
    ["build", "API build"],
    ["eval:classifier", "Classifier evaluation"],
    ["eval:automation", "Automation entity evaluation"],
    ["eval:rag", "Retrieval evaluation"],
    ["eval:golden", "Workflow golden evaluation"],
  ];
  for (const [script, label] of checks) {
    console.log(`\n== ${label} ==`);
    run(npm, ["--prefix", api, "run", script], process.env);
  }
  run(npm, ["--prefix", api, "exec", "--", "tsx", "--test", path.join(root, "evals", "golden-contract.test.ts")]);
}

function runFrontendChecks() {
  const web = path.join(root, "apps", "web");
  for (const script of ["lint", "typecheck", "test", "build"]) {
    console.log(`\n== Frontend ${script} ==`);
    const args = ["run", script];
    if (script === "lint") args.push("--", "--max-warnings=0");
    run(npm, ["--prefix", web, ...args], process.env);
  }
}

function runQuality() {
  run(process.execPath, ["scripts/quality/vibe-check.test.mjs"]);
  run(process.execPath, ["scripts/quality/vibe-check.mjs", "--json", "work/quality-gate-report.json", "--fail-on", "high"]);
}

function runCheck() {
  runApiChecks();
  runQuality();
  runFrontendChecks();

  const previous = {
    REDIS_URL: process.env.REDIS_URL,
    WEB_ORIGIN: process.env.WEB_ORIGIN,
    SERVICEPILOT_TENANT_ID: process.env.SERVICEPILOT_TENANT_ID,
  };
  const created = [];
  const secrets = ["openai_api_key", "database_url", "postgres_password", "jwt_secret", "webhook_secret", "admin_password", "session_secret"];
  try {
    console.log("\n== Compose validation ==");
    compose(["config", "--quiet"]);
    process.env.REDIS_URL = "redis://redis:6379/0";
    process.env.WEB_ORIGIN = "https://servicepilot.example";
    process.env.SERVICEPILOT_TENANT_ID = "tenant-validation";
    const secretDir = path.join(root, ".secrets");
    mkdirSync(secretDir, { recursive: true });
    for (const secret of secrets) {
      const file = path.join(secretDir, secret);
      if (!existsSync(file)) {
        writeFileSync(file, "compose-validation", { mode: 0o600 });
        created.push(file);
      }
    }
    const productionArgs = ["-f", "compose.yaml", "-f", "compose.production.yaml", "config", "--quiet"];
    compose(productionArgs);
    const rendered = runOutput("docker", ["compose", "--project-directory", root, ...["-f", "compose.yaml", "-f", "compose.production.yaml", "config"]]);
    if (/change-this-before-sharing|local-session-secret-change-me/u.test(rendered)) {
      throw new Error("Production Compose leaked a development secret default");
    }
  } finally {
    for (const file of created) rmSync(file, { force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function runDev(args) {
  const port = Number(option(args, "--port", "8080"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer between 1 and 65535");
  // shipproof-ignore SP109
  const env = { NGINX_PORT: String(port), WEB_ORIGIN: `http://localhost:${port}` };
  const envFile = path.join(root, ".env.local");
  const composeArgs = [];
  if (existsSync(envFile)) composeArgs.push("--env-file", envFile);
  composeArgs.push("up", "--build", "--wait");
  // shipproof-ignore SP109
  console.log(`Starting ServicePilot through Nginx at http://localhost:${port}`);
  compose(composeArgs, env);
}

function runAiEval() {
  const api = path.join(root, "apps", "api");
  for (const script of ["eval:classifier", "eval:automation", "eval:rag", "eval:golden"]) {
    console.log(`\n== AI ${script} ==`);
    run(npm, ["--prefix", api, "run", script], process.env);
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/gu, "").slice(0, 14);
}

async function promptSecret(label) {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Set OPENAI_API_KEY before running init:production in a non-interactive shell");
  process.stdout.write(`${label}: `);
  return new Promise((resolve, reject) => {
    let value = "";
    const input = process.stdin;
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Secret input cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (character === "\u0008" || character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    const cleanup = () => {
      input.removeListener("data", onData);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function initProduction(args) {
  const publicOrigin = option(args, "--origin");
  const tenantId = option(args, "--tenant", "tenant-production");
  const port = Number(option(args, "--port", "8080"));
  if (!publicOrigin || !/^https:\/\//u.test(publicOrigin)) throw new Error("--origin must be an HTTPS URL, for example https://support.example.com");
  new URL(publicOrigin);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer between 1 and 65535");
  const openAiKey = await promptSecret("OpenAI API key");
  if (!openAiKey) throw new Error("OpenAI API key is required");

  const secretDir = path.join(root, ".secrets");
  mkdirSync(secretDir, { recursive: true });
  const postgresPassword = randomBytes(48).toString("base64url");
  const secrets = {
    openai_api_key: openAiKey,
    postgres_password: postgresPassword,
    database_url: `postgresql://servicepilot:${postgresPassword}@postgres:5432/servicepilot`,
    jwt_secret: randomBytes(48).toString("base64url"),
    webhook_secret: randomBytes(48).toString("base64url"),
    admin_password: randomBytes(48).toString("base64url"),
    session_secret: randomBytes(48).toString("base64url"),
  };
  for (const [name, value] of Object.entries(secrets)) writeFileSync(path.join(secretDir, name), `${value}\n`, { mode: 0o600 });
  const env = [
    "APP_ENV=production",
    `NGINX_PORT=${port}`,
    `DEPLOYMENT_VERSION=${timestamp()}`,
    `WEB_ORIGIN=${publicOrigin.replace(/\/$/u, "")}`,
    "OPENAI_MODEL=gpt-5.6-luna",
    "OPENAI_REASONING_EFFORT=low",
    "REDIS_URL=redis://redis:6379/0",
    "JWT_ISSUER=servicepilot",
    "JWT_AUDIENCE=servicepilot-api",
    `SERVICEPILOT_TENANT_ID=${tenantId}`,
    "SERVICEPILOT_ADMIN_SUBJECT=support-admin",
    "OTEL_ENABLED=false",
    "",
  ].join("\n");
  writeFileSync(path.join(root, ".env.production"), env, { mode: 0o600 });
  console.log("Created .env.production and restricted files under .secrets/. Store an encrypted backup before deployment.");
}

function runDeploy(args) {
  const environmentFile = option(args, "--env-file", ".env.production");
  const envPath = path.resolve(root, environmentFile);
  if (!existsSync(envPath)) throw new Error(`Missing ${environmentFile}. Run npm run init:production first.`);
  for (const secret of ["openai_api_key", "database_url", "postgres_password", "jwt_secret", "webhook_secret", "admin_password", "session_secret"]) {
    requiredFile(path.join(".secrets", secret), `Missing .secrets/${secret}. Run npm run init:production first.`);
  }
  const composeArgs = ["--env-file", envPath];
  if (hasOption(args, "--observability")) composeArgs.push("--profile", "observability");
  composeArgs.push("-f", "compose.yaml", "-f", "compose.production.yaml", "up", "--build", "--force-recreate", "--wait", "--wait-timeout", "180");
  compose(composeArgs);
  console.log(`ServicePilot is healthy. Open the WEB_ORIGIN configured in ${environmentFile}.`);
}

function help() {
  console.log(`ServicePilot commands (cross-platform):

  npm run dev -- --port 8180
  npm run check
  npm run quality
  npm run ai:eval
  npm run init:production -- --origin https://support.example.com --tenant tenant-company --port 8080
  npm run deploy -- --observability

Use --env-file <file> with deploy when production settings are stored elsewhere.`);
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") return help();
  if (command === "dev") return runDev(args);
  if (command === "check") return runCheck();
  if (command === "quality") return runQuality();
  if (command === "ai-eval") return runAiEval();
  if (command === "init-production") return initProduction(args);
  if (command === "deploy") return runDeploy(args);
  throw new Error(`Unknown command: ${command}. Run npm run help or inspect package.json.`);
}

main().catch(fail);
