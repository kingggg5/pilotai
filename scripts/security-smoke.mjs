const baseUrl = (process.env.SECURITY_TEST_URL || "http://127.0.0.1:8001").replace(/\/$/u, "");
const expectAuth = process.env.SECURITY_EXPECT_AUTH !== "false";

async function request(path, init) {
	return fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
}

const checks = [];
const health = await request("/health/live");
checks.push(["health endpoint", health.status === 200]);

const unauthenticated = await request("/api/v1/me");
checks.push(["protected endpoint rejects anonymous request", expectAuth ? unauthenticated.status === 401 : [200, 401].includes(unauthenticated.status)]);

const malformed = await request("/api/v1/me", { headers: { authorization: "Bearer definitely-not-a-jwt" } });
checks.push(["protected endpoint rejects malformed bearer token", expectAuth ? malformed.status === 401 : [200, 401].includes(malformed.status)]);

const ticket = await request("/api/v1/tickets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "security smoke test" }) });
checks.push(["ticket mutation rejects anonymous request", expectAuth ? ticket.status === 401 : [201, 401, 403].includes(ticket.status)]);

const metrics = await request("/metrics");
const metricsBody = await metrics.text();
checks.push(["metrics endpoint is available", metrics.status === 200 && metricsBody.includes("servicepilot_requests_total")]);
checks.push(["metrics do not contain obvious secret fields", !/(authorization|api[_-]?key|password|customer@example)/iu.test(metricsBody)]);

const failed = checks.filter(([, passed]) => !passed);
for (const [name, passed] of checks) console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
if (!expectAuth) console.log("INFO production auth assertions were disabled for a local-auth target");
if (failed.length) {
	console.error(`${failed.length} security smoke check(s) failed against ${baseUrl}`);
	process.exitCode = 1;
}
