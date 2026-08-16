const baseUrl = (process.env.LOAD_TEST_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const concurrency = Math.max(1, Math.min(100, Number(process.env.LOAD_TEST_CONCURRENCY || 10)));
const durationMs = Math.max(1_000, Math.min(300_000, Number(process.env.LOAD_TEST_DURATION_MS || 15_000)));
// Scenario "health" probes liveness; "assist" exercises the authenticated
// workflow path (POST /api/v1/assist) so load tests reflect real work.
const scenario = process.env.LOAD_TEST_SCENARIO === "assist" ? "assist" : "health";
const actorId = process.env.LOAD_TEST_ACTOR_ID || "load-test-agent";
const tenantId = process.env.LOAD_TEST_TENANT_ID || "tenant-load";
const bearerToken = process.env.LOAD_TEST_TOKEN || "";
const assistMessage = process.env.LOAD_TEST_MESSAGE || "Where is my order? It has not arrived yet.";
const started = Date.now();
const samples = [];
let failures = 0;

function nextRequest() {
	if (scenario === "health") return { method: "GET", path: "/health/live", headers: {}, body: null };
	const headers = { "Content-Type": "application/json", "x-actor-id": actorId, "x-tenant-id": tenantId };
	if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
	return { method: "POST", path: "/api/v1/assist", headers, body: JSON.stringify({ message: assistMessage, locale: "en", metadata: {} }) };
}

async function worker(workerIndex) {
	while (Date.now() - started < durationMs) {
		const begin = performance.now();
		try {
			const request = nextRequest();
			const response = await fetch(`${baseUrl}${request.path}`, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				signal: AbortSignal.timeout(15_000),
			});
			if (!response.ok) {
				failures += 1;
				if (process.env.LOAD_TEST_VERBOSE) console.error(`worker ${workerIndex}: ${request.path} -> ${response.status}`);
			}
			if (request.body) await response.arrayBuffer();
		} catch (error) {
			failures += 1;
			if (process.env.LOAD_TEST_VERBOSE) console.error(`worker ${workerIndex}: ${error instanceof Error ? error.message : "request failed"}`);
		}
		samples.push(performance.now() - begin);
	}
}

await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index)));
samples.sort((a, b) => a - b);
const percentile = (ratio) => samples[Math.max(0, Math.ceil(samples.length * ratio) - 1)] ?? 0;
const elapsed = Math.max(1, Date.now() - started);
const rps = samples.length / (elapsed / 1_000);
const failureRate = samples.length ? failures / samples.length : 1;
console.log(JSON.stringify({ baseUrl, scenario, concurrency, duration_ms: elapsed, requests: samples.length, failures, failure_rate: Number(failureRate.toFixed(4)), rps: Number(rps.toFixed(2)), p50_ms: Number(percentile(0.5).toFixed(2)), p95_ms: Number(percentile(0.95).toFixed(2)), p99_ms: Number(percentile(0.99).toFixed(2)) }, null, 2));
if (!samples.length || failureRate > 0.01 || percentile(0.95) > Number(process.env.LOAD_TEST_P95_MS || 2_000)) process.exitCode = 1;
