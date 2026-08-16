"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ActionToast, type Notice } from "@/components/action-toast";
import { AdminKpiPanel } from "@/components/admin-kpi-panel";
import { postJson } from "@/lib/browser-api";
import { localizePriority, localizeStatus, type Copy } from "@/lib/i18n";
import { queueDataUrl, queuePageUrl } from "@/lib/queue-filters";
import type { ConsoleData, Decision, KpiAnalytics, Language, Priority, QueueFilters, Run, Ticket, TicketStatus } from "@/lib/types";

const teams = ["Customer Support", "Sales & Orders", "Billing & Refunds", "Technical Support", "Trust & Safety"];
const statuses: TicketStatus[] = ["new", "investigating", "needs_approval", "draft_ready", "resolved"];
const priorities: Priority[] = ["urgent", "high", "normal", "low"];

type TicketUpdate = (ticket: Ticket) => void;
type NoticeUpdate = (notice: Notice) => void;

export function AdminWorkspace({ initialData, kpi, copy, language, filters }: { initialData: ConsoleData; kpi?: KpiAnalytics | null; copy: Copy; language: Language; filters: QueueFilters }) {
	const router = useRouter();
	const [data, setData] = useState(initialData);
	const [selectedId, setSelectedId] = useState(initialData.tickets[0]?.id || "");
	const [note, setNote] = useState("");
	const [pending, setPending] = useState<Decision>();
	const [error, setError] = useState("");
	const [notice, setNotice] = useState<Notice | null>(null);
	const [incoming, setIncoming] = useState<Ticket[]>([]);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState(false);
	const [feedbackSent, setFeedbackSent] = useState<Record<string, boolean>>({});
	const seenIds = useRef(new Set(initialData.tickets.map((ticket) => ticket.id)));
	const refreshInFlight = useRef(false);
	const tickets = data.tickets;
	const runs = data.runs;
	const selected = tickets.find((ticket) => ticket.id === selectedId) || tickets[0];
	const run = selected ? runs[selected.id] : undefined;

	const refreshQueue = useCallback(async (announce = false) => {
		if (refreshInFlight.current) return;
		refreshInFlight.current = true;
		setRefreshing(true);
		try {
			const response = await fetch(queueDataUrl(filters, data.offset, data.limit), { cache: "no-store", signal: AbortSignal.timeout(10_000) });
			if (!response.ok) throw new Error("Queue refresh failed");
			const next = await response.json() as ConsoleData;
			if (next.source !== "live") throw new Error(next.loadError || "Queue refresh failed");
			setRefreshError(false);
			const fresh = next.tickets.filter((ticket) => !seenIds.current.has(ticket.id));
			next.tickets.forEach((ticket) => seenIds.current.add(ticket.id));
			if (fresh.length) {
				const chats = fresh.filter((ticket) => ticket.channel === "chat" && ticket.status !== "resolved");
				if (chats.length) {
					setIncoming((current) => {
						const existing = new Set(current.map((ticket) => ticket.id));
						return [...current, ...chats.filter((ticket) => !existing.has(ticket.id))];
					});
					setNotice({ tone: "info", message: `${chats.length} ${copy.admin.newChat}` });
				}
			}
			setData(next);
			setSelectedId((current) => next.tickets.some((ticket) => ticket.id === current) ? current : next.tickets[0]?.id || "");
		} catch (reason) {
			setRefreshError(true);
			if (announce) setNotice({ tone: "error", message: reason instanceof Error ? reason.message : copy.admin.refreshFailed });
		} finally {
			refreshInFlight.current = false;
			setRefreshing(false);
		}
	}, [copy.admin.newChat, copy.admin.refreshFailed, data.limit, data.offset, filters]);

	useEffect(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refreshQueue();
		}, 15_000);
		return () => window.clearInterval(timer);
	}, [refreshQueue]);

	async function decide(decision: Decision) {
		if (!run || !selected) return;

		setPending(decision);
		setError("");
		try {
			const payload = await postJson<{ run?: Run }>("/api/decision", { runId: run.id, decision, note });
			if (!payload.run) throw new Error("Decision failed");

			setData((current) => ({ ...current, runs: { ...current.runs, [selected.id]: payload.run! } }));
			setNote("");
			setNotice({ tone: "success", message: decision === "approve" ? copy.admin.approved : copy.admin.rejected });
			void refreshQueue();
		} catch (reason) {
			const message = reason instanceof Error ? reason.message : "Decision failed";
			setError(message);
			setNotice({ tone: "error", message });
		} finally {
			setPending(undefined);
		}
	}

	if (data.source === "unavailable") {
		return <main className="admin-empty"><strong>{copy.admin.unavailable}</strong><p>{data.loadError}</p><button className="primary-button" type="button" onClick={() => router.refresh()}>{copy.admin.retry}</button></main>;
	}

	return (
		<main className="admin-shell">
			{kpi ? <AdminKpiPanel kpi={kpi} copy={copy} language={language} /> : null}
			<AiPulse data={data} copy={copy} />
			{incoming.length ? <IncomingChatBanner chats={incoming} copy={copy} onOpen={() => { setSelectedId(incoming[0].id); setIncoming([]); setNotice(null); }} /> : null}
			<div className="queue-refresh-bar"><span className={refreshError ? "queue-refresh-error" : undefined} aria-live="polite">{refreshing ? copy.admin.refreshing : refreshError ? copy.admin.refreshFailed : `${copy.admin.refreshed} ${new Date(data.checkedAt).toLocaleTimeString(language === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" })}`}</span><button type="button" onClick={() => void refreshQueue(true)} disabled={refreshing}>{refreshing ? "…" : copy.admin.refreshQueue}</button></div>
			<QueueFilters copy={copy} language={language} filters={filters} />
			<div className="admin-workspace">
				<aside className="queue-pane" aria-label={copy.admin.queue}>
					<div className="queue-title"><div><span className="live-dot" />{copy.admin.live}</div><strong>{data.total}</strong></div>
					<p className="queue-result-label">{data.total} {copy.admin.results}</p>
					<div className="ticket-list" aria-busy={refreshing}>
						{tickets.length ? tickets.map((ticket) => (
							<button key={ticket.id} type="button" aria-pressed={selected?.id === ticket.id} onClick={() => setSelectedId(ticket.id)}>
								<span className={`priority-mark priority-${ticket.priority}`} />
								<span><small>{ticket.reference} · {localizePriority(copy, ticket.priority)}{ticket.tags.includes("purchase") ? ` · ${copy.admin.purchase}` : ""}</small><strong>{ticket.subject}</strong><em>{ticket.customer} · {ticket.channel.toUpperCase()}{ticket.amount ? ` · ${ticket.amount}` : ""}</em></span>
								<b>{new Date(ticket.createdAt).toLocaleDateString(language === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short" })}</b>
							</button>
						)) : <p className="empty-copy">{copy.admin.empty}</p>}
					</div>
					<Pagination data={data} filters={filters} language={language} />
				</aside>
				<section className="ticket-pane">
					{selected && run ? <TicketWorkspace ticket={selected} run={run} copy={copy} language={language} note={note} setNote={setNote} pending={pending} error={error} decide={decide} feedbackDone={Boolean(feedbackSent[selected.id])} onFeedbackSent={() => setFeedbackSent((current) => ({ ...current, [selected.id]: true }))} onTicket={(ticket) => setData((current) => ({ ...current, tickets: current.tickets.map((item) => item.id === ticket.id ? ticket : item) }))} onNotice={setNotice} /> : <p className="empty-copy">{copy.admin.empty}</p>}
				</section>
			</div>
			<ActionToast notice={notice} onDismiss={() => setNotice(null)} dismissLabel={copy.commerce.dismiss} />
		</main>
	);
}

function IncomingChatBanner({ chats, copy, onOpen }: { chats: Ticket[]; copy: Copy; onOpen: () => void }) {
	return <section className="incoming-chat-banner" role="status" aria-live="polite"><span className="incoming-chat-mark" aria-hidden="true" /><div><strong>{chats.length} {copy.admin.newChat}</strong><p>{chats[0]?.customer} · {chats[0]?.subject}</p></div><button type="button" onClick={onOpen}>{copy.admin.openChat}</button></section>;
}

function AiPulse({ data, copy }: { data: ConsoleData; copy: Copy }) {
	const runs = Object.values(data.runs);
	const handled = runs.filter((run) => run.ai.provider !== "pending").length;
	const approval = runs.filter((run) => run.state === "awaiting_approval").length;
	const gaps = runs.filter((run) => !run.ai.sufficientEvidence).length;

	return <section className="ai-pulse" aria-label={copy.admin.aiLive}><div><span className="ai-live-dot" /><strong>{copy.admin.aiLive}</strong><p>{copy.admin.aiQueueSummary}</p></div><dl><div><dt>{copy.admin.aiHandled}</dt><dd>{handled}/{runs.length}</dd></div><div><dt>{copy.admin.aiApproval}</dt><dd>{approval}</dd></div><div><dt>{copy.admin.aiEvidenceGap}</dt><dd>{gaps}</dd></div></dl></section>;
}

function QueueFilters({ copy, language, filters }: { copy: Copy; language: Language; filters: QueueFilters }) {
	return (
		<form className="queue-filters" action="/admin" method="get">
			<input type="hidden" name="lang" value={language} />
			<div className="filter-heading"><strong>{copy.admin.filters}</strong><Link href={`/admin?lang=${language}`}>{copy.admin.clear}</Link></div>
			<label className="filter-wide"><span>{copy.admin.query}</span><input name="q" type="search" defaultValue={filters.query} placeholder={copy.admin.queryPlaceholder} /></label>
			<label><span>{copy.admin.number}</span><input name="number" defaultValue={filters.number} placeholder={copy.admin.numberPlaceholder} /></label>
			<label><span>{copy.admin.from}</span><input name="from" type="date" defaultValue={filters.createdFrom} /></label>
			<label><span>{copy.admin.to}</span><input name="to" type="date" defaultValue={filters.createdTo} /></label>
			<label><span>{copy.admin.priorityFilter}</span><select name="priority" defaultValue={filters.priority || ""}><option value="">{copy.admin.all}</option>{priorities.map((value) => <option key={value} value={value}>{localizePriority(copy, value)}</option>)}</select></label>
			<label><span>{copy.admin.statusFilter}</span><select name="status" defaultValue={filters.status || ""}><option value="">{copy.admin.all}</option>{statuses.map((value) => <option key={value} value={value}>{localizeStatus(copy, value)}</option>)}</select></label>
			<label><span>{copy.admin.channel}</span><select name="channel" defaultValue={filters.channel || ""}><option value="">{copy.admin.all}</option><option value="web">Web</option><option value="email">Email</option><option value="chat">Chat</option></select></label>
			<label><span>{copy.admin.handlingMode}</span><select name="handling" defaultValue={filters.handlingMode || ""}><option value="">{copy.admin.all}</option>{(["manual", "copilot", "autopilot"] as const).map((value) => <option key={value} value={value}>{copy.admin.handlingModes[value]}</option>)}</select></label>
			<label><span>{copy.admin.sort}</span><select name="sort" defaultValue={filters.sort}><option value="newest">{copy.admin.newest}</option><option value="oldest">{copy.admin.oldest}</option><option value="priority">{copy.admin.prioritySort}</option></select></label>
			<button className="primary-button" type="submit">{copy.admin.apply}</button>
		</form>
	);
}

function Pagination({ data, filters, language }: { data: ConsoleData; filters: QueueFilters; language: Language }) {
	if (data.total <= data.limit) return null;

	const current = Math.floor(data.offset / data.limit) + 1;
	return <nav className="queue-pagination" aria-label="Ticket pages">{current > 1 ? <Link href={queuePageUrl(language, filters, current - 1)}>←</Link> : <span />}<small>{data.offset + 1}–{Math.min(data.offset + data.tickets.length, data.total)} / {data.total}</small>{data.offset + data.limit < data.total ? <Link href={queuePageUrl(language, filters, current + 1)}>→</Link> : <span />}</nav>;
}

function TicketWorkspace({ ticket, run, copy, language, note, setNote, pending, error, decide, feedbackDone, onFeedbackSent, onTicket, onNotice }: { ticket: Ticket; run: Run; copy: Copy; language: Language; note: string; setNote: (value: string) => void; pending?: Decision; error: string; decide: (decision: Decision) => void; feedbackDone: boolean; onFeedbackSent: () => void; onTicket: TicketUpdate; onNotice: NoticeUpdate }) {
	return (
		<>
			<header className="ticket-header">
				<div><span>{ticket.reference}</span><h2>{ticket.subject}</h2><p>{ticket.channel === "chat" ? `${ticket.customer} · ${copy.admin.conversation}` : ticket.summary}</p></div>
				<span className={`state-badge state-${ticket.status}`}>{localizeStatus(copy, ticket.status)}</span>
			</header>
			<TicketOverview ticket={ticket} run={run} copy={copy} language={language} />
			<div className="admin-columns">
				<div className="work-column">
					{ticket.channel === "chat" ? <AdminChatPreview ticket={ticket} run={run} copy={copy} onNotice={onNotice} /> : <section className="work-section request-section"><span className="section-label">{copy.admin.fullRequest}</span><h3>{copy.admin.subject}</h3><p>{ticket.summary}</p></section>}
					{ticket.channel === "chat" ? null : <DraftCard run={run} copy={copy} onNotice={onNotice} />}
					<DraftFeedback key={ticket.id} ticket={ticket} copy={copy} done={feedbackDone} onSent={onFeedbackSent} onNotice={onNotice} />
					<EvidenceCard run={run} copy={copy} />
				</div>
				<aside className="decision-column">
					<ApprovalCard ticket={ticket} run={run} copy={copy} note={note} setNote={setNote} pending={pending} error={error} decide={decide} />
					<AiReview run={run} copy={copy} />
					<AutomationCard run={run} copy={copy} />
					<TicketControls key={`${ticket.id}-${ticket.status}-${ticket.priority}-${ticket.assignedTeam}`} ticket={ticket} copy={copy} onTicket={onTicket} onNotice={onNotice} />
					<WorkflowTrace run={run} copy={copy} />
				</aside>
			</div>
		</>
	);
}

function AdminChatPreview({ ticket, run, copy, onNotice }: { ticket: Ticket; run: Run; copy: Copy; onNotice: NoticeUpdate }) {
	const [copied, setCopied] = useState(false);
	const response = run.draft || run.recommendation || copy.admin.noEvidence;

	async function copyResponse() {
		try {
			await navigator.clipboard.writeText(response);
			setCopied(true);
			onNotice({ tone: "success", message: copy.admin.copied });
			window.setTimeout(() => setCopied(false), 1_500);
		} catch {
			onNotice({ tone: "error", message: copy.admin.copyFailed });
		}
	}

	return (
		<section className="work-section admin-chat-preview" aria-label={copy.admin.conversation}>
			<div className="section-heading"><div><span className="section-label">{copy.admin.conversation}</span><h3>{ticket.customer}</h3></div><span className="channel-badge">CHAT</span></div>
			<div className="admin-chat-thread">
				<article className="admin-chat-bubble admin-chat-customer"><small>{copy.admin.customerMessage} · {ticket.reference}</small><p>{ticket.summary}</p></article>
				<article className="admin-chat-bubble admin-chat-ai"><small>{copy.admin.aiDraft} · {run.ai.provider}</small><p>{response}</p></article>
			</div>
			<footer className="admin-chat-footer"><small>{copy.admin.draftNotSent}</small><button type="button" onClick={copyResponse}>{copied ? copy.admin.copied : copy.admin.copyDraft}</button></footer>
		</section>
	);
}

function TicketOverview({ ticket, run, copy, language }: { ticket: Ticket; run: Run; copy: Copy; language: Language }) {
	const date = (value: string) => new Date(value).toLocaleString(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
	const summary = [ticket.customer, ticket.assignedTeam, localizePriority(copy, ticket.priority)].filter(Boolean).join(" · ");

	return (
		<details className="ticket-overview">
			<summary><span>{copy.admin.summary}</span><strong>{summary}</strong></summary>
			<dl className="ticket-facts">
				<Fact label={copy.admin.customer} value={ticket.customer} />
				<Fact label={copy.admin.email} value={ticket.customerEmail || (ticket.customerId?.includes("@") ? ticket.customerId : "—")} />
				<Fact label={copy.admin.phone} value={ticket.customerPhone || "—"} />
				<Fact label={copy.admin.contact} value={ticket.customerId || "—"} />
				<Fact label={copy.admin.orderNumber} value={ticket.orderId || "—"} />
				<Fact label={copy.admin.channel} value={ticket.channel} />
				<Fact label={copy.admin.created} value={date(ticket.createdAt)} />
				<Fact label={copy.admin.updated} value={date(ticket.updatedAt)} />
				<Fact label={copy.admin.team} value={ticket.assignedTeam} />
				<Fact label={copy.admin.handlingMode} value={copy.admin.handlingModes[ticket.handlingMode]} />
				<Fact label={copy.admin.confidence} value={`${Math.round(run.confidence * 100)}%`} />
				{ticket.amount ? <Fact label={copy.commerce.subtotal} value={ticket.amount} /> : null}
			</dl>
		</details>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function DraftCard({ run, copy, onNotice }: { run: Run; copy: Copy; onNotice: NoticeUpdate }) {
	const [copied, setCopied] = useState(false);

	async function copyDraft() {
		try {
			await navigator.clipboard.writeText(run.draft);
			setCopied(true);
			onNotice({ tone: "success", message: copy.admin.copied });
			window.setTimeout(() => setCopied(false), 1_500);
		} catch {
			onNotice({ tone: "error", message: "Clipboard unavailable" });
		}
	}

	return <section className="work-section draft-section"><div className="section-heading"><h3>{copy.admin.draft}</h3>{run.draft ? <button type="button" onClick={copyDraft}>{copied ? copy.admin.copied : copy.admin.copyDraft}</button> : null}</div><blockquote>{run.draft || copy.admin.noEvidence}</blockquote></section>;
}

function DraftFeedback({ ticket, copy, done, onSent, onNotice }: { ticket: Ticket; copy: Copy; done: boolean; onSent: () => void; onNotice: NoticeUpdate }) {
	const [choice, setChoice] = useState<"thumbs_up" | "thumbs_down">();
	const [note, setNote] = useState("");
	const [sending, setSending] = useState(false);

	async function send(feedbackType: "thumbs_up" | "thumbs_down", notes?: string) {
		setSending(true);
		try {
			const payload = await postJson<{ success: boolean }>("/api/admin/feedback", { ticketId: ticket.id, feedbackType, ...(notes ? { notes } : {}) });
			if (!payload.success) throw new Error(copy.admin.feedback.failed);
			setChoice(undefined);
			setNote("");
			onSent();
			onNotice({ tone: "success", message: copy.admin.feedback.sent });
		} catch (reason) {
			onNotice({ tone: "error", message: reason instanceof Error ? reason.message : copy.admin.feedback.failed });
		} finally {
			setSending(false);
		}
	}

	function submitNote(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (sending) return;
		void send("thumbs_down", note.trim() || undefined);
	}

	if (done) return <p className="draft-feedback-done" role="status">{copy.admin.feedback.sent}</p>;

	return (
		<section className="work-section draft-feedback" aria-label={copy.admin.feedback.title}>
			<div className="section-heading"><h3>{copy.admin.feedback.title}</h3></div>
			{choice === "thumbs_down" ? (
				<form className="draft-feedback-form" onSubmit={submitNote}>
					<label className="sr-only" htmlFor={`feedback-note-${ticket.id}`}>{copy.admin.feedback.noteLabel}</label>
					<input id={`feedback-note-${ticket.id}`} maxLength={2_000} placeholder={copy.admin.feedback.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} />
					<div className="draft-feedback-actions">
						<button type="button" disabled={sending} onClick={() => void send("thumbs_up")}>{copy.admin.feedback.helpful}</button>
						<button className="primary-button" disabled={sending} type="submit">{sending ? copy.admin.feedback.sending : copy.admin.feedback.send}</button>
					</div>
				</form>
			) : (
				<div className="draft-feedback-actions">
					<button type="button" aria-label={copy.admin.feedback.helpful} disabled={sending} onClick={() => void send("thumbs_up")}>👍 {copy.admin.feedback.helpful}</button>
					<button type="button" aria-label={copy.admin.feedback.needsWork} disabled={sending} onClick={() => setChoice("thumbs_down")}>👎 {copy.admin.feedback.needsWork}</button>
				</div>
			)}
		</section>
	);
}

function EvidenceCard({ run, copy }: { run: Run; copy: Copy }) {
	return (
		<section className="work-section evidence-section">
			<h3>{copy.admin.evidence}</h3>
			{run.evidence.length ? run.evidence.map((item) => <article key={item.id}><div><strong>{item.title}</strong><b>{Math.round(item.score * 100)}%</b></div><p>{item.excerpt}</p><small>{item.source} · {item.section}</small></article>) : <p>{copy.admin.noEvidence}</p>}
		</section>
	);
}

function TicketControls({ ticket, copy, onTicket, onNotice }: { ticket: Ticket; copy: Copy; onTicket: TicketUpdate; onNotice: NoticeUpdate }) {
	const [status, setStatus] = useState(ticket.status);
	const [priority, setPriority] = useState(ticket.priority);
	const [team, setTeam] = useState(ticket.assignedTeam);
	const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

	async function save() {
		setState("saving");
		try {
			const response = await fetch("/api/ticket-management", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: ticket.id, status, priority, assignedTeam: team }) });
			const payload = await response.json() as { ticket?: Ticket; message?: string };
			if (!response.ok || !payload.ticket) throw new Error(payload.message || "Update failed");

			onTicket(payload.ticket);
			setState("saved");
			onNotice({ tone: "success", message: copy.admin.savedTicket });
		} catch {
			setState("error");
			onNotice({ tone: "error", message: "Update failed" });
		}
	}

	return (
		<details className="admin-details ticket-controls">
			<summary><span>{copy.admin.team}</span><strong>{team} · {localizePriority(copy, priority)}</strong></summary>
			<div className="detail-content">
				<label><span>{copy.admin.team}</span><select value={team} onChange={(event) => setTeam(event.target.value)}>{teams.map((value) => <option key={value}>{value}</option>)}</select></label>
				<div className="control-grid"><label><span>{copy.admin.ticketStatus}</span><select value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)}>{statuses.map((value) => <option key={value} value={value}>{localizeStatus(copy, value)}</option>)}</select></label><label><span>{copy.admin.ticketPriority}</span><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map((value) => <option key={value} value={value}>{localizePriority(copy, value)}</option>)}</select></label></div>
				{state === "saved" ? <p className="save-note">{copy.admin.savedTicket}</p> : null}
				{state === "error" ? <p className="form-error" role="alert">Update failed</p> : null}
				<button className="primary-button" disabled={state === "saving"} type="button" onClick={save}>{state === "saving" ? copy.admin.savingTicket : copy.admin.saveTicket}</button>
			</div>
		</details>
	);
}

function AiReview({ run, copy }: { run: Run; copy: Copy }) {
	const category = run.ai.category === "purchase" ? copy.admin.purchase : run.ai.category;
	const evidence = run.ai.sufficientEvidence ? copy.admin.yes : copy.admin.no;

	return (
		<details className="admin-details ai-review">
			<summary><span>{copy.admin.aiReview}</span><strong>{category} · {evidence}</strong></summary>
			<div className="detail-content">
				<p className="ai-review-provider"><span className="ai-live-dot" />{run.ai.provider === "openai" ? copy.admin.aiLive : run.ai.provider}</p>
				<dl><Fact label={copy.admin.aiCategory} value={category} /><Fact label={copy.admin.aiRisk} value={run.ai.riskLevel} /><Fact label={copy.admin.aiModel} value={run.ai.modelVersion} /><Fact label={copy.admin.aiProvider} value={run.ai.provider} /></dl>
				{run.ai.reasons.length ? <ul>{run.ai.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
			</div>
		</details>
	);
}

function AutomationCard({ run, copy }: { run: Run; copy: Copy }) {
	const mode = automationMode(run, copy);
	const complete = run.automation.mode === "auto_completed";

	return (
		<details className="admin-details automation-card">
			<summary><span>{copy.admin.automation}</span><strong className={complete ? "ai-pass" : "ai-warn"}>{mode}</strong></summary>
			<div className="detail-content"><p><strong>{copy.admin.handlingMode}:</strong> {copy.admin.handlingModes[run.automation.handlingMode]}</p>{run.automation.nextQuestion ? <p><strong>{copy.admin.nextQuestion}:</strong> {run.automation.nextQuestion}</p> : null}<ul>{run.automation.actions.map((action, index) => <li key={`${action.type}-${index}`}><strong>{action.type.replaceAll("_", " ")}</strong> · {action.status}<br /><small>{action.detail}</small></li>)}</ul></div>
		</details>
	);
}

function automationMode(run: Run, copy: Copy) {
	const modes = { manual_queue: copy.admin.manualQueue, copilot_ready: copy.admin.copilotReady, auto_completed: copy.admin.autoCompleted, needs_customer: copy.admin.needsCustomer, auto_routed: copy.admin.autoRouted };
	return modes[run.automation.mode as keyof typeof modes] || run.automation.mode.replaceAll("_", " ");
}

function WorkflowTrace({ run, copy }: { run: Run; copy: Copy }) {
	const latest = run.trace.at(-1);

	return (
		<details className="admin-details trace-section">
			<summary><span>{copy.admin.trace}</span><strong>{latest?.title || "—"}</strong></summary>
			<div className="detail-content">{run.trace.map((step) => <div key={step.id}><i className={`trace-${step.status}`} /><span><strong>{step.title}</strong><small>{step.detail}</small></span></div>)}</div>
		</details>
	);
}

function ApprovalCard({ ticket, run, copy, note, setNote, pending, error, decide }: { ticket: Ticket; run: Run; copy: Copy; note: string; setNote: (value: string) => void; pending?: Decision; error: string; decide: (decision: Decision) => void }) {
	if (run.decision) return <section className="approval-card resolved"><span>✓</span><div><h3>{run.decision === "approve" ? copy.admin.approved : copy.admin.rejected}</h3>{run.escalationId ? <p>{run.escalationId}</p> : null}</div></section>;
	if (run.state !== "awaiting_approval") return <section className="approval-card passive"><h3>{copy.admin.approval}</h3><p>{copy.admin.noAction}</p></section>;

	return (
		<section className="approval-card">
			<span className="section-label">{copy.admin.approval}</span>
			<h3>{copy.admin.proposed}</h3>
			<strong>{ticket.requestedAction}</strong>
			{ticket.amount ? <b>{ticket.amount}</b> : null}
			<dl className="approval-signals"><Fact label={copy.admin.aiRisk} value={run.ai.riskLevel} /><Fact label={copy.admin.aiEvidence} value={run.ai.sufficientEvidence ? copy.admin.yes : copy.admin.no} /></dl>
			<label><span>{copy.admin.note}</span><textarea rows={4} maxLength={2_000} placeholder={copy.admin.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} /></label>
			{error ? <p className="form-error" role="alert">{error}</p> : null}
			<div className="decision-actions"><button disabled={Boolean(pending)} type="button" onClick={() => decide("reject")}>{pending === "reject" ? copy.admin.saving : copy.admin.reject}</button><button disabled={Boolean(pending)} type="button" onClick={() => decide("approve")}>{pending === "approve" ? copy.admin.saving : copy.admin.approve}</button></div>
		</section>
	);
}
