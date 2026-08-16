"use client";

import { useEffect, useRef, useState } from "react";

import { postJson } from "@/lib/browser-api";
import { localizeStatus, type Copy } from "@/lib/i18n";
import type { HandlingMode, Language, Run, TicketWorkItem } from "@/lib/types";

type ChatMessage = {
	id: string;
	role: "assistant" | "user";
	text: string;
	pending?: boolean;
	error?: boolean;
	item?: TicketWorkItem;
};

function orderIdFrom(text: string) {
	const match = text.match(/\b(?:ORD|ORDER|SO)[-\s]?[A-Z0-9]{4,}\b/i);
	if (!match) return undefined;

	return match[0].replace(/^ORDER[-\s]?/i, "ORD-").replace(/\s+/g, "-").toUpperCase();
}

function requestsStaff(text: string) {
	return /เจ้าหน้าที่|พนักงาน|คนจริง|human|agent|specialist|representative/i.test(text);
}

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

function messageText(item: TicketWorkItem, copy: Copy) {
	const status = workflowMessage(item.run, copy);
	return item.run.draft && item.run.draft !== status ? `${status}\n\n${item.run.draft}` : status;
}

export function LiveSupportChat({ language, copy, profile, initialMessage = "" }: { language: Language; copy: Copy; profile?: { name: string; email: string }; initialMessage?: string }) {
	const [draft, setDraft] = useState(initialMessage);
	const [messages, setMessages] = useState<ChatMessage[]>([{ id: "welcome", role: "assistant", text: copy.customer.chatGreeting }]);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const idempotencyKey = useRef(crypto.randomUUID());
	const logRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
		logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior });
	}, [messages, pending]);

	async function sendMessage(value: string, handlingMode?: HandlingMode) {
		if (pending) return;
		const text = value.trim();
		if (text.length < 3) {
			setError(copy.customer.required);
			return;
		}

		const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
		const pendingId = crypto.randomUUID();
		setMessages((current) => [...current, userMessage, { id: pendingId, role: "assistant", text: copy.customer.chatTyping, pending: true }]);
		setDraft("");
		setError("");
		setPending(true);

		try {
			const item = await postJson<{ item?: TicketWorkItem }>("/api/tickets", {
				customer: profile?.name || "",
				customerId: profile?.email || "",
				orderId: orderIdFrom(text),
				message: text,
				channel: "chat",
				locale: language,
				handlingMode: handlingMode || (requestsStaff(text) ? "manual" : "autopilot"),
				idempotencyKey: idempotencyKey.current,
			});
			if (!item.item) throw new Error(copy.customer.failed);

			setMessages((current) => current.map((message) => message.id === pendingId ? { ...message, pending: false, text: messageText(item.item!, copy), item: item.item } : message));
			idempotencyKey.current = crypto.randomUUID();
		} catch {
			const message = copy.customer.failed;
			setMessages((current) => current.map((item) => item.id === pendingId ? { ...item, pending: false, error: true, text: message } : item));
			setError(message);
		} finally {
			setPending(false);
		}
	}

	function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		void sendMessage(draft);
	}

	function quickReply(text: string, handlingMode?: HandlingMode) {
		void sendMessage(text, handlingMode);
	}

	function reset() {
		setMessages([{ id: "welcome", role: "assistant", text: copy.customer.chatGreeting }]);
		setDraft("");
		setError("");
		idempotencyKey.current = crypto.randomUUID();
	}

	return (
		<section className="conversation-card chat-card" aria-labelledby="chat-title">
			<header className="chat-header">
				<div><p className="section-label">{copy.customer.chatTitle}</p><h2 id="chat-title">{copy.customer.chatIntro}</h2></div>
				<span className="chat-status"><i />{language === "th" ? "AI พร้อมช่วย" : "AI is ready"}</span>
			</header>
			<div ref={logRef} className="chat-log" role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending} aria-label={copy.customer.chatTitle}>
				{messages.map((message) => <ChatMessageView key={message.id} message={message} copy={copy} />)}
			</div>
			<div className="chat-quick-actions" aria-label={language === "th" ? "ตัวเลือกด่วน" : "Quick actions"}>
				<button type="button" disabled={pending} onClick={() => quickReply(language === "th" ? "ช่วยตรวจสอบสถานะคำสั่งซื้อให้หน่อยครับ" : "Please check my order status.")}>{copy.customer.chatOrder}</button>
				<button type="button" disabled={pending} onClick={() => quickReply(language === "th" ? "พบปัญหากับคำสั่งซื้อหรือการชำระเงินครับ" : "I have an issue with my order or payment.")}>{copy.customer.chatIssue}</button>
				<button type="button" disabled={pending} onClick={() => quickReply(language === "th" ? "ต้องการคุยกับเจ้าหน้าที่ครับ" : "I would like to talk to a specialist.", "manual")}>{copy.customer.chatStaff}</button>
			</div>
			<form className="chat-composer" onSubmit={submit} noValidate>
				<label className="sr-only" htmlFor="support-message">{copy.customer.message}</label>
				<textarea id="support-message" required disabled={pending} maxLength={8_000} rows={3} placeholder={copy.customer.chatInputPlaceholder} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(draft); } }} />
				<div className="chat-composer-footer"><small>{draft.length.toLocaleString()} / 8,000 · {language === "th" ? "กด Enter เพื่อส่ง · Shift + Enter ขึ้นบรรทัดใหม่" : "Enter to send · Shift + Enter for a new line"}</small><button className="primary-button" disabled={pending || draft.trim().length < 3} type="submit">{pending ? copy.customer.chatTyping : copy.customer.chatSend}<span aria-hidden="true">→</span></button></div>
				{error ? <p className="form-error" role="alert">{error}</p> : null}
			</form>
			<button className="chat-reset" type="button" disabled={pending} onClick={reset}>{copy.customer.chatNew}</button>
		</section>
	);
}

function ChatMessageView({ message, copy }: { message: ChatMessage; copy: Copy }) {
	return (
		<div className={`chat-message chat-message-${message.role}`}>
			<div className="chat-avatar" aria-hidden="true">{message.role === "assistant" ? "✳" : "คุณ"}</div>
			<article className={`chat-bubble${message.error ? " chat-bubble-error" : ""}`}>
				<p>{message.text}</p>
				{message.pending ? <span className="chat-typing" aria-hidden="true"><i /><i /><i /></span> : null}
				{message.item ? <ChatTicketStatus item={message.item} copy={copy} /> : null}
			</article>
		</div>
	);
}

function ChatTicketStatus({ item, copy }: { item: TicketWorkItem; copy: Copy }) {
	return (
		<div className="chat-ticket-status">
			<div className="chat-ticket-heading"><strong>ServicePilot</strong><span>{localizeStatus(copy, item.ticket.status)}</span></div>
			<dl><div><dt>{copy.customer.chatReference}</dt><dd>{item.ticket.reference}</dd></div>{item.ticket.orderId ? <div><dt>{copy.customer.chatOrderDetected}</dt><dd>{item.ticket.orderId}</dd></div> : null}<div><dt>{copy.customer.handlingTitle}</dt><dd>{copy.customer.handlingModes[item.run.automation.handlingMode].title}</dd></div></dl>
			{item.run.evidence.length ? <small>{copy.customer.evidence}: {item.run.evidence.slice(0, 2).map((evidence) => evidence.title).join(" · ")}</small> : null}
		</div>
	);
}
