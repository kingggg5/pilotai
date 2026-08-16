"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { postJson } from "@/lib/browser-api";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function AdminLogin({ copy, language, configured }: { copy: Copy; language: Language; configured: boolean }) {
	const router = useRouter();
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setError("");
		try {
			await postJson("/api/admin/session", { password });
			router.replace(`/admin?lang=${language}`);
			router.refresh();
		} catch {
			setError(copy.login.failed);
		} finally {
			setPending(false);
		}
	}

	return (
		<main className="login-main">
			<section className="login-card">
				<div className="service-mark" aria-hidden="true">✳</div>
				<h1>{copy.login.title}</h1>
				<p>{configured ? copy.login.subtitle : copy.login.unavailable}</p>
				{configured ? (
					<form onSubmit={submit}>
						<label><span>{copy.login.password}</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
						{error ? <p className="form-error" role="alert">{error}</p> : null}
						<button className="primary-button" disabled={pending} type="submit">{pending ? copy.login.submitting : copy.login.submit}</button>
					</form>
				) : null}
			</section>
		</main>
	);
}
