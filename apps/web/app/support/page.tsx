import { redirect } from "next/navigation";

import { CustomerTicketForm } from "@/components/customer-ticket-form";
import { SiteHeader } from "@/components/site-header";
import { getCustomerSession } from "@/lib/customer-auth";
import { getCopy, parseLanguage } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ lang?: string; topic?: string; quantity?: string }> }) {
	const query = await searchParams;
	const language = parseLanguage(query.lang);
	const customer = await getCustomerSession();
	const quantity = String(Math.min(10, Math.max(1, Number.parseInt(query.quantity || "1", 10) || 1)));
	const returnPath = query.topic === "purchase" ? `/support?topic=purchase&quantity=${quantity}` : "/support";
	if (!customer) redirect(`/account/login?lang=${language}&next=${encodeURIComponent(returnPath)}`);
	const copy = getCopy(language);

	return (
		<div className="customer-page">
			<SiteHeader language={language} copy={copy} route="/support" />
			<main className="customer-main">
				<section className="customer-intro" aria-labelledby="customer-title">
					<div className="service-mark" aria-hidden="true">✳</div>
					<p className="section-label">{copy.customer.eyebrow}</p>
					<h1 id="customer-title">{copy.customer.title}</h1>
					<p className="intro-copy">{copy.customer.intro}</p>
					<ol className="service-steps">
						{copy.customer.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}
					</ol>
				</section>
				<CustomerTicketForm language={language} copy={copy} profile={{ name: customer.name, email: customer.email }} initialMessage={query.topic === "purchase" ? copy.commerce.requestMessage.replace("{quantity}", quantity) : undefined} />
			</main>
			<footer className="customer-footer"><strong>ServicePilot</strong><span>{copy.customer.safe}</span></footer>
		</div>
	);
}
