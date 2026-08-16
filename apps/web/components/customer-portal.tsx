"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { PromptPayModal } from "@/components/promptpay-modal";
import { postJson } from "@/lib/browser-api";
import { localizePriority, localizeStatus, type Copy } from "@/lib/i18n";
import type { CustomerProfile, Language, OrderTracking, Ticket } from "@/lib/types";

export function CustomerPortal({ initialProfile, tickets, language, copy }: { initialProfile: CustomerProfile; tickets: Ticket[]; language: Language; copy: Copy }) {
	const router = useRouter();
	const [profile, setProfile] = useState(initialProfile);
	const [saved, setSaved] = useState(false);
	const [tracking, setTracking] = useState<OrderTracking>();
	const [trackedOrderId, setTrackedOrderId] = useState<string>("");
	const [showQrModal, setShowQrModal] = useState(false);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);

	async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setPending(true);
		setSaved(false);
		const form = new FormData(event.currentTarget);
		try {
			const payload = await postJson<{ profile?: CustomerProfile }>("/api/customer/profile", {
				name: form.get("name"),
				phone: form.get("phone"),
			});
			if (!payload.profile) throw new Error("Update failed");
			setProfile(payload.profile);
			setSaved(true);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Update failed");
		} finally {
			setPending(false);
		}
	}

	async function track(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setTracking(undefined);
		const form = new FormData(event.currentTarget);
		const inputId = String(form.get("orderId") || "");
		setTrackedOrderId(inputId);
		try {
			const payload = await postJson<{ tracking?: OrderTracking }>("/api/customer/track", {
				orderId: inputId,
			});
			if (!payload.tracking) throw new Error("Tracking failed");
			setTracking(payload.tracking);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Tracking failed");
		}
	}

	async function logout() {
		await fetch("/api/customer/session", { method: "DELETE" });
		router.replace(`/?lang=${language}`);
		router.refresh();
	}

	return (
		<main className="account-main">
			<header className="account-heading">
				<div>
					<span>{copy.account.customerId}: {profile.id}</span>
					<h1>{copy.account.title}</h1>
					<p>{copy.account.subtitle}</p>
				</div>
				<button className="text-button" type="button" onClick={logout}>
					{copy.account.logout}
				</button>
			</header>

			<div className="account-layout">
				<section className="profile-panel">
					<h2>{copy.account.profile}</h2>
					<form onSubmit={saveProfile}>
						<label>
							<span>{copy.account.name}</span>
							<input name="name" required defaultValue={profile.name} />
						</label>
						<label>
							<span>{copy.account.email}</span>
							<input readOnly value={profile.email} />
						</label>
						<label>
							<span>{copy.account.phone}</span>
							<input name="phone" required defaultValue={profile.phone} />
						</label>
						{saved && <p className="save-note">{copy.account.saved}</p>}
						<button className="primary-button" disabled={pending} type="submit">
							{copy.account.save}
						</button>
					</form>
				</section>

				<section className="tracking-panel">
					<h2>{copy.account.tracking}</h2>
					<p>{copy.account.trackingHelp}</p>
					<form className="tracking-form" onSubmit={track}>
						<label>
							<span>{copy.account.trackingId}</span>
							<input name="orderId" required maxLength={128} placeholder="ORD-…" />
						</label>
						<button className="primary-button" type="submit">
							{copy.account.track}
						</button>
					</form>
					{error && <p className="form-error" role="alert">{error}</p>}
					{tracking && (
						<div style={{ marginTop: "24px" }}>
							<dl className="tracking-result" style={{ marginTop: 0 }}>
								<div>
									<dt>{copy.account.status}</dt>
									<dd>{tracking.status}</dd>
								</div>
								<div>
									<dt>{copy.account.trackingNumber}</dt>
									<dd>{tracking.trackingNumber || "—"}</dd>
								</div>
								<div>
									<dt>{copy.account.delivery}</dt>
									<dd>{tracking.estimatedDelivery || "—"}</dd>
								</div>
							</dl>
							{tracking.status !== "paid" ? (
								<div style={{ marginTop: "16px" }}>
									<button
										className="primary-button"
										type="button"
										onClick={() => setShowQrModal(true)}
									>
										{language === "th" ? "สแกนชำระเงินด้วย PromptPay QR" : "Pay via PromptPay QR"}
									</button>
								</div>
							) : null}
						</div>
					)}
				</section>

				{showQrModal && trackedOrderId ? (
					<PromptPayModal
						orderId={trackedOrderId}
						amount={48900}
						language={language}
						onPaid={() => {
							setShowQrModal(false);
							setTracking((prev) => prev ? { ...prev, status: "paid" } : prev);
						}}
						onClose={() => setShowQrModal(false)}
					/>
				) : null}

				<section className="account-tickets">
					<div className="section-heading">
						<h2>{copy.account.tickets}</h2>
						<Link className="primary-button" href={`/support?lang=${language}`}>
							{copy.account.openSupport}
						</Link>
					</div>

					{tickets.length ? (
						<div className="account-ticket-list">
							{tickets.map((ticket) => (
								<article key={ticket.id}>
									<div>
										<span>{ticket.reference}</span>
										<time>{new Date(ticket.createdAt).toLocaleDateString(language === "th" ? "th-TH" : "en-GB")}</time>
									</div>
									<h3>{ticket.subject}</h3>
									<p>{ticket.summary}</p>
									<footer>
										<b>{localizeStatus(copy, ticket.status)}</b>
										<span>{localizePriority(copy, ticket.priority)}</span>
										{ticket.orderId && <span>{ticket.orderId}</span>}
									</footer>
								</article>
							))}
						</div>
					) : (
						<p className="empty-copy">{copy.account.noTickets}</p>
					)}
				</section>
			</div>
		</main>
	);
}
