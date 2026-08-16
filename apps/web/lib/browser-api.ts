export async function postJson<T>(url: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const raw = await response.text();
	let result: T & { message?: string } = {} as T & { message?: string };
	if (raw) {
		try { result = JSON.parse(raw) as T & { message?: string }; } catch { /* Non-JSON upstream errors still receive a safe status message. */ }
	}
	if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
	return result;
}
