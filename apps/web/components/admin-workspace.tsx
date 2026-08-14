"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { postJson } from "@/lib/browser-api";
import { ActionToast, type Notice } from "@/components/action-toast";
import { localizePriority, localizeStatus, type Copy } from "@/lib/i18n";
import { queuePageUrl } from "@/lib/queue-filters";
import type { ConsoleData, Decision, Language, Priority, QueueFilters, Run, Ticket, TicketStatus } from "@/lib/types";

const teams = ["Customer Support", "Sales & Orders", "Billing & Refunds", "Technical Support", "Trust & Safety"];
const statuses: TicketStatus[] = ["new", "investigating", "needs_approval", "draft_ready", "resolved"];
const priorities: Priority[] = ["urgent", "high", "normal", "low"];

export function AdminWorkspace({ initialData, copy, language, filters }: { initialData: ConsoleData; copy: Copy; language: Language; filters: QueueFilters }) {
  const router = useRouter();
  const [tickets, setTickets] = useState(initialData.tickets);
  const [runs, setRuns] = useState(initialData.runs);
  const [selectedId, setSelectedId] = useState(initialData.tickets[0]?.id || "");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Decision>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const selected = tickets.find((ticket) => ticket.id === selectedId) || tickets[0];
  const run = selected ? runs[selected.id] : undefined;

  async function decide(decision: Decision) {
    if (!run || !selected) return;
    setPending(decision); setError("");
    try {
      const payload = await postJson<{ run?: Run }>("/api/decision", { runId: run.id, decision, note });
      if (!payload.run) throw new Error("Decision failed");
      setRuns((current) => ({ ...current, [selected.id]: payload.run! }));
      setNote("");
      setNotice({ tone: "success", message: decision === "approve" ? copy.admin.approved : copy.admin.rejected });
    } catch (reason) { const message = reason instanceof Error ? reason.message : "Decision failed"; setError(message); setNotice({ tone: "error", message }); }
    finally { setPending(undefined); }
  }

  if (initialData.source === "unavailable") return <main className="admin-empty"><strong>{copy.admin.unavailable}</strong><p>{initialData.loadError}</p><button className="primary-button" type="button" onClick={() => router.refresh()}>{copy.admin.retry}</button></main>;

  return (
    <main className="admin-shell">
      <AiPulse data={initialData} copy={copy} />
      <QueueFilters copy={copy} language={language} filters={filters} />
      <div className="admin-workspace">
        <aside className="queue-pane" aria-label={copy.admin.queue}>
          <div className="queue-title"><div><span className="live-dot" />{copy.admin.live}</div><strong>{initialData.total}</strong></div>
          <p className="queue-result-label">{initialData.total} {copy.admin.results}</p>
          <div className="ticket-list">
            {tickets.length ? tickets.map((ticket) => (
              <button key={ticket.id} type="button" aria-pressed={selected?.id === ticket.id} onClick={() => setSelectedId(ticket.id)}>
                <span className={`priority-mark priority-${ticket.priority}`} />
                <span><small>{ticket.reference} · {localizePriority(copy, ticket.priority)}{ticket.tags.includes("purchase") ? ` · ${copy.admin.purchase}` : ""}</small><strong>{ticket.subject}</strong><em>{ticket.customer} · {ticket.channel}{ticket.amount ? ` · ${ticket.amount}` : ""}</em></span>
                <b>{new Date(ticket.createdAt).toLocaleDateString(language === "th" ? "th-TH" : "en-GB", { day: "2-digit", month: "short" })}</b>
              </button>
            )) : <p className="empty-copy">{copy.admin.empty}</p>}
          </div>
          <Pagination data={initialData} filters={filters} language={language} />
        </aside>
        <section className="ticket-pane">
          {selected && run ? <TicketWorkspace ticket={selected} run={run} copy={copy} language={language} note={note} setNote={setNote} pending={pending} error={error} decide={decide} onTicket={(ticket) => setTickets((current) => current.map((item) => item.id === ticket.id ? ticket : item))} onNotice={setNotice} /> : <p className="empty-copy">{copy.admin.empty}</p>}
        </section>
      </div>
      <ActionToast notice={notice} onDismiss={() => setNotice(null)} dismissLabel={copy.commerce.dismiss} />
    </main>
  );
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

function TicketWorkspace({ ticket, run, copy, language, note, setNote, pending, error, decide, onTicket, onNotice }: { ticket: Ticket; run: Run; copy: Copy; language: Language; note: string; setNote: (value: string) => void; pending?: Decision; error: string; decide: (decision: Decision) => void; onTicket: (ticket: Ticket) => void; onNotice: (notice: Notice) => void }) {
  const date = (value: string) => new Date(value).toLocaleString(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <header className="ticket-header"><div><span>{ticket.reference}</span><h2>{ticket.subject}</h2><p>{ticket.summary}</p></div><span className={`state-badge state-${ticket.status}`}>{localizeStatus(copy, ticket.status)}</span></header>
      <dl className="ticket-facts ticket-facts-rich">
        <Fact label={copy.admin.customer} value={ticket.customer} /><Fact label={copy.admin.email} value={ticket.customerEmail || (ticket.customerId?.includes("@") ? ticket.customerId : "—")} /><Fact label={copy.admin.phone} value={ticket.customerPhone || "—"} /><Fact label={copy.admin.contact} value={ticket.customerId || "—"} />
        <Fact label={copy.admin.orderNumber} value={ticket.orderId || "—"} /><Fact label={copy.admin.channel} value={ticket.channel} /><Fact label={copy.admin.created} value={date(ticket.createdAt)} /><Fact label={copy.admin.updated} value={date(ticket.updatedAt)} />
        <Fact label={copy.admin.team} value={ticket.assignedTeam} /><Fact label={copy.admin.confidence} value={`${Math.round(run.confidence * 100)}%`} />{ticket.amount ? <Fact label={copy.commerce.subtotal} value={ticket.amount} /> : null}
      </dl>
      <div className="admin-columns">
        <div className="work-column">
          <section className="work-section request-section"><span className="section-label">{copy.admin.fullRequest}</span><h3>{copy.admin.subject}</h3><p>{ticket.summary}</p></section>
          <DraftCard run={run} copy={copy} onNotice={onNotice} />
          <section className="work-section evidence-section"><h3>{copy.admin.evidence}</h3>{run.evidence.length ? run.evidence.map((item) => <article key={item.id}><div><strong>{item.title}</strong><b>{Math.round(item.score * 100)}%</b></div><p>{item.excerpt}</p><small>{item.source} · {item.section}</small></article>) : <p>{copy.admin.noEvidence}</p>}</section>
        </div>
        <div className="decision-column">
          <TicketControls key={ticket.id} ticket={ticket} copy={copy} onTicket={onTicket} onNotice={onNotice} />
          <AiReview run={run} copy={copy} />
          <ApprovalCard ticket={ticket} run={run} copy={copy} note={note} setNote={setNote} pending={pending} error={error} decide={decide} />
          <section className="trace-section"><h3>{copy.admin.trace}</h3>{run.trace.map((step) => <div key={step.id}><i className={`trace-${step.status}`} /><span><strong>{step.title}</strong><small>{step.detail}</small></span></div>)}</section>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

function DraftCard({ run, copy, onNotice }: { run: Run; copy: Copy; onNotice: (notice: Notice) => void }) {
  const [copied, setCopied] = useState(false);
  async function copyDraft() { try { await navigator.clipboard.writeText(run.draft); setCopied(true); onNotice({ tone: "success", message: copy.admin.copied }); window.setTimeout(() => setCopied(false), 1_500); } catch { onNotice({ tone: "error", message: "Clipboard unavailable" }); } }
  return <section className="work-section draft-section"><div className="section-heading"><h3>{copy.admin.draft}</h3>{run.draft ? <button type="button" onClick={copyDraft}>{copied ? copy.admin.copied : copy.admin.copyDraft}</button> : null}</div><blockquote>{run.draft || copy.admin.noEvidence}</blockquote></section>;
}

function TicketControls({ ticket, copy, onTicket, onNotice }: { ticket: Ticket; copy: Copy; onTicket: (ticket: Ticket) => void; onNotice: (notice: Notice) => void }) {
  const [status, setStatus] = useState(ticket.status); const [priority, setPriority] = useState(ticket.priority); const [team, setTeam] = useState(ticket.assignedTeam); const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  async function save() {
    setState("saving");
    try {
      const response = await fetch("/api/ticket-management", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticketId: ticket.id, status, priority, assignedTeam: team }) });
      const payload = await response.json() as { ticket?: Ticket; message?: string };
      if (!response.ok || !payload.ticket) throw new Error(payload.message || "Update failed");
      onTicket(payload.ticket); setState("saved"); onNotice({ tone: "success", message: copy.admin.savedTicket });
    } catch { setState("error"); onNotice({ tone: "error", message: "Update failed" }); }
  }
  return <section className="ticket-controls"><h3>{copy.admin.proposed}</h3><label><span>{copy.admin.team}</span><select value={team} onChange={(event) => setTeam(event.target.value)}>{teams.map((value) => <option key={value}>{value}</option>)}</select></label><div className="control-grid"><label><span>{copy.admin.ticketStatus}</span><select value={status} onChange={(event) => setStatus(event.target.value as TicketStatus)}>{statuses.map((value) => <option key={value} value={value}>{localizeStatus(copy, value)}</option>)}</select></label><label><span>{copy.admin.ticketPriority}</span><select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{priorities.map((value) => <option key={value} value={value}>{localizePriority(copy, value)}</option>)}</select></label></div>{state === "saved" ? <p className="save-note">{copy.admin.savedTicket}</p> : null}{state === "error" ? <p className="form-error" role="alert">Update failed</p> : null}<button className="primary-button" disabled={state === "saving"} type="button" onClick={save}>{state === "saving" ? copy.admin.savingTicket : copy.admin.saveTicket}</button></section>;
}

function AiReview({ run, copy }: { run: Run; copy: Copy }) {
  const category = run.ai.category === "purchase" ? copy.admin.purchase : run.ai.category;
  return <section className="ai-review"><div className="section-heading"><h3>{copy.admin.aiReview}</h3><span className={run.ai.sufficientEvidence ? "ai-pass" : "ai-warn"}>{run.ai.sufficientEvidence ? copy.admin.yes : copy.admin.no}</span></div><p className="ai-review-provider"><span className="ai-live-dot" />{run.ai.provider === "openai" ? copy.admin.aiLive : run.ai.provider}</p><dl><Fact label={copy.admin.aiCategory} value={category} /><Fact label={copy.admin.aiRisk} value={run.ai.riskLevel} /><Fact label={copy.admin.aiModel} value={run.ai.modelVersion} /><Fact label={copy.admin.aiProvider} value={run.ai.provider} /></dl>{run.ai.reasons.length ? <ul>{run.ai.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</section>;
}

function ApprovalCard({ ticket, run, copy, note, setNote, pending, error, decide }: { ticket: Ticket; run: Run; copy: Copy; note: string; setNote: (value: string) => void; pending?: Decision; error: string; decide: (decision: Decision) => void }) {
  if (run.decision) return <section className="approval-card resolved"><span>✓</span><div><h3>{run.decision === "approve" ? copy.admin.approved : copy.admin.rejected}</h3>{run.escalationId ? <p>{run.escalationId}</p> : null}</div></section>;
  if (run.state !== "awaiting_approval") return <section className="approval-card passive"><h3>{copy.admin.approval}</h3><p>{copy.admin.noAction}</p></section>;
  return <section className="approval-card"><span className="section-label">{copy.admin.approval}</span><h3>{copy.admin.proposed}</h3><strong>{ticket.requestedAction}</strong>{ticket.amount ? <b>{ticket.amount}</b> : null}<label><span>{copy.admin.note}</span><textarea rows={4} maxLength={2_000} placeholder={copy.admin.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} /></label>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="decision-actions"><button disabled={Boolean(pending)} type="button" onClick={() => decide("reject")}>{pending === "reject" ? copy.admin.saving : copy.admin.reject}</button><button disabled={Boolean(pending)} type="button" onClick={() => decide("approve")}>{pending === "approve" ? copy.admin.saving : copy.admin.approve}</button></div></section>;
}
