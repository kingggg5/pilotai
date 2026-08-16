export async function postJson<T>(url: string, body: unknown): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const result = await response.json() as T & { message?: string };
	if (!response.ok) throw new Error(result.message || `Request failed (${response.status})`);
	return result;
}
