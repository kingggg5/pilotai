"use client";

import { useRef, useState } from "react";

import { postJson } from "@/lib/browser-api";
import type { Copy } from "@/lib/i18n";
import type { HandlingMode, Language, Run, TicketWorkItem } from "@/lib/types";

type FormState = { customer: string; customerId: string; orderId: string; message: string; handlingMode: HandlingMode };
const emptyForm: FormState = { customer: "", customerId: "", orderId: "", message: "", handlingMode: "autopilot" };

function workflowMessage(run: Run, copy: Copy): string {
  if (run.automation.mode === "manual_queue") return copy.customer.manualQueued;
  if (run.automation.mode === "copilot_ready") return copy.customer.copilotReady;
  if (run.automation.mode === "auto_completed") return copy.customer.autoCompleted;
  if (run.automation.nextQuestion) return run.automation.nextQuestion;
  if (run.state === "awaiting_approval") return copy.customer.awaiting;
  if (run.state === "needs_evidence") return copy.customer.insufficient;
  if (run.state === "completed") return copy.customer.completed;
  return copy.customer.processing;
}

export function CustomerTicketForm({ language, copy, profile, initialMessage = "" }: { language: Language; copy: Copy; profile?: { name: string; email: string }; initialMessage?: string }) {
  const initialForm = { ...emptyForm, customer: profile?.name || "", customerId: profile?.email || "", message: initialMessage };
  const [form, setForm] = useState<FormState>(initialForm);
  const [result, setResult] = useState<TicketWorkItem>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  function update<Field extends keyof FormState>(field: Field, value: FormState[Field]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.customer.trim() || !form.customerId.trim() || form.message.trim().length < 3) {
      setError(copy.customer.required);
      return;
    }
    setPending(true);
    setError("");
    try {
      const payload = await postJson<{ item?: TicketWorkItem }>("/api/tickets", {
        ...form,
        channel: "web",
        locale: language,
        idempotencyKey: idempotencyKey.current,
      });
      if (!payload.item) throw new Error(copy.customer.failed);
      setResult(payload.item);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : copy.customer.failed);
    } finally {
      setPending(false);
    }
  }

  if (result) {
    const { ticket, run } = result;
    return (
      <section className="conversation-card result-card" aria-live="polite">
        <div className="result-mark" aria-hidden="true">✓</div>
        <p className="section-label">{copy.customer.received}</p>
        <h2>{ticket.reference}</h2>
        <p className="result-summary">{workflowMessage(run, copy)}</p>
        <dl className="result-meta">
          <div><dt>{copy.customer.reference}</dt><dd>{ticket.reference}</dd></div>
          {ticket.orderId ? <div><dt>{copy.customer.order}</dt><dd>{ticket.orderId}</dd></div> : null}
          <div><dt>{copy.customer.handlingTitle}</dt><dd>{copy.customer.handlingModes[run.automation.handlingMode].title}</dd></div>
        </dl>
        {run.draft ? (
          <div className="support-reply">
            <span>ServicePilot</span>
            <p>{run.draft}</p>
          </div>
        ) : null}
        {run.evidence.length ? (
          <div className="customer-sources">
            <strong>{copy.customer.evidence}</strong>
            {run.evidence.slice(0, 3).map((item) => <span key={item.id}>{item.title} · {item.section}</span>)}
          </div>
        ) : null}
        <button className="primary-button" type="button" onClick={() => { setResult(undefined); setForm(initialForm); idempotencyKey.current = crypto.randomUUID(); }}>
          {copy.customer.reset}
        </button>
      </section>
    );
  }

  return (
    <section className="conversation-card" aria-labelledby="ticket-form-title">
      <p className="section-label">{copy.customer.formTitle}</p>
      <h2 id="ticket-form-title">{copy.customer.formIntro}</h2>
      <form onSubmit={submit} noValidate>
        <fieldset className="handling-modes">
          <legend>{copy.customer.handlingTitle}</legend>
          <p>{copy.customer.handlingIntro}</p>
          <div>
            {(Object.keys(copy.customer.handlingModes) as HandlingMode[]).map((mode) => {
              const option = copy.customer.handlingModes[mode];
              return (
                <label key={mode} className="handling-option">
                  <input type="radio" name="handlingMode" value={mode} checked={form.handlingMode === mode} onChange={() => update("handlingMode", mode)} />
                  <span><strong>{option.title}{mode === "autopilot" ? <em>{copy.customer.recommended}</em> : null}</strong><small>{option.description}</small></span>
                </label>
              );
            })}
          </div>
          <small className="handling-boundary">{copy.customer.handlingBoundary}</small>
        </fieldset>
        <div className="field-grid">
          <label><span>{copy.customer.name}</span><input required readOnly={Boolean(profile)} maxLength={128} autoComplete="name" value={form.customer} onChange={(event) => update("customer", event.target.value)} /></label>
          <label><span>{copy.customer.contact}</span><input required readOnly={Boolean(profile)} maxLength={128} autoComplete="email" value={form.customerId} onChange={(event) => update("customerId", event.target.value)} /></label>
        </div>
        <label><span>{copy.customer.order}</span><input maxLength={128} autoComplete="off" value={form.orderId} onChange={(event) => update("orderId", event.target.value)} /></label>
        <label>
          <span>{copy.customer.message}</span>
          <textarea required maxLength={8_000} rows={7} placeholder={copy.customer.messagePlaceholder} value={form.message} onChange={(event) => update("message", event.target.value)} />
          <small>{form.message.length.toLocaleString()} / 8,000</small>
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" disabled={pending} type="submit">{pending ? copy.customer.sending : copy.customer.send}<span aria-hidden="true">→</span></button>
        <p className="form-assurance"><span aria-hidden="true">●</span>{copy.customer.safe}</p>
      </form>
    </section>
  );
}
