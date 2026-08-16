const baseUrl = (process.env.LOAD_TEST_URL || "http://127.0.0.1:8001").replace(/\/$/u, "");
const concurrency = Math.max(1, Math.min(100, Number(process.env.LOAD_TEST_CONCURRENCY || 10)));
const durationMs = Math.max(1_000, Math.min(300_000, Number(process.env.LOAD_TEST_DURATION_MS || 15_000)));
const started = Date.now();
const samples = [];
let failures = 0;

async function worker() {
	while (Date.now() - started < durationMs) {
		const begin = performance.now();
		try {
			const response = await fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(5_000) });
			if (!response.ok) failures += 1;
		} catch { failures += 1; }
		samples.push(performance.now() - begin);
	}
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
samples.sort((a, b) => a - b);
const percentile = (ratio) => samples[Math.max(0, Math.ceil(samples.length * ratio) - 1)] ?? 0;
const elapsed = Math.max(1, Date.now() - started);
const rps = samples.length / (elapsed / 1_000);
const failureRate = samples.length ? failures / samples.length : 1;
console.log(JSON.stringify({ baseUrl, concurrency, duration_ms: elapsed, requests: samples.length, failures, failure_rate: Number(failureRate.toFixed(4)), rps: Number(rps.toFixed(2)), p50_ms: Number(percentile(0.5).toFixed(2)), p95_ms: Number(percentile(0.95).toFixed(2)), p99_ms: Number(percentile(0.99).toFixed(2)) }, null, 2));
if (!samples.length || failureRate > 0.01 || percentile(0.95) > Number(process.env.LOAD_TEST_P95_MS || 2_000)) process.exitCode = 1;
