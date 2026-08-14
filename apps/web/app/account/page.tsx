import { redirect } from "next/navigation";
import { CustomerPortal } from "@/components/customer-portal";
import { SiteHeader } from "@/components/site-header";
import { getCustomerTickets } from "@/lib/api";
import { getCustomerSession } from "@/lib/customer-auth";
import { getCopy, parseLanguage } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) { const language = parseLanguage((await searchParams).lang); const session = await getCustomerSession(); if (!session) redirect(`/account/login?lang=${language}`); const copy = getCopy(language); const tickets = await getCustomerTickets().catch(() => []); const profile = { id: session.sub, name: session.name, email: session.email, phone: session.phone, createdAt: "", updatedAt: "" }; return <div className="account-page"><SiteHeader language={language} copy={copy} route="/account" /><CustomerPortal initialProfile={profile} tickets={tickets} language={language} copy={copy} /></div>; }
