import assert from "node:assert/strict";
import { analyzeFile, buildReport, scoreFindings } from "./vibe-check.mjs";

const clean = analyzeFile("apps/api/src/example.ts", "export const answer = 42;\n");
assert.deepEqual(clean, []);

const secret = analyzeFile("apps/api/src/config.ts", `const token = "sk-${"a".repeat(24)}";`);
assert.equal(secret.length, 1);
assert.equal(secret[0].severity, "critical");
assert.equal(secret[0].evidence, "[redacted]");

const redis = analyzeFile("apps/api/src/security.ts", "await client.eval('return 1', { keys: [] });");
assert.deepEqual(redis, []);

const skipped = analyzeFile("apps/api/tests/example.test.ts", "test.skip('later', () => {});");
assert.equal(skipped[0].id, "P2-SKIPPED-TEST");
assert.equal(scoreFindings(skipped), 85);

const report = buildReport(3, [...secret, ...skipped]);
assert.equal(report.score, 60);
assert.deepEqual(report.counts, { low: 0, medium: 0, high: 1, critical: 1 });

console.log("quality gate contracts passed");
