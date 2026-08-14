import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadSettings } from "../src/config.js";

test("configuration reads secrets from mounted files", (context) => {
  const file = join(tmpdir(), `servicepilot-secret-${process.pid}.txt`);
  context.after(() => unlinkSync(file));
  writeFileSync(file, "mounted-secret\n", { mode: 0o600 });
  const settings = loadSettings({ APP_ENV: "test", JWT_SECRET_FILE: file, AUTH_MODE: "jwt", PERSISTENCE_MODE: "memory", AI_MODE: "local" });
  assert.equal(settings.JWT_SECRET, "mounted-secret");
});

test("development configuration normalizes empty optional secrets", () => {
  const settings = loadSettings({
    APP_ENV: "development",
    AUTH_MODE: "local",
    PERSISTENCE_MODE: "memory",
    AI_MODE: "local",
    OPENAI_API_KEY: " ",
    JWT_SECRET: "",
    WEBHOOK_SECRET: "",
  });
  assert.equal(settings.OPENAI_API_KEY, undefined);
  assert.equal(settings.JWT_SECRET, undefined);
  assert.equal(settings.WEBHOOK_SECRET, undefined);
});
