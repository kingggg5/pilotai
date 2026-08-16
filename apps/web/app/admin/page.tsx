/*
THESIS: Staff operate from one ordered queue, not a marketing scroll.
OWN-WORLD: Graphite workbench, paper evidence, lime only for live and confirmed states.
STORY: Select a ticket, verify evidence, approve or reject, inspect the audit trail.
FIRST VIEWPORT: Fixed queue left, complete selected-ticket workspace right.
FORM: Two-pane operations workbench in the established Proof Studio system.
*/
import { redirect } from "next/navigation";

import { AdminHeader } from "@/components/admin-header";
import { AdminWorkspace } from "@/components/admin-workspace";
import { hasAdminSession } from "@/lib/admin-auth";
import { getConsoleData } from "@/lib/api";
import { getCopy, parseLanguage } from "@/lib/i18n";
import { parseQueueFilters } from "@/lib/queue-filters";

export const dynamic = "force-dynamic";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
	const params = await searchParams;
	const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
	const language = parseLanguage(first(params.lang));
	const page = Math.max(1, Number.parseInt(first(params.page) || "1", 10) || 1);
	const filters = parseQueueFilters(params);
	if (!await hasAdminSession()) redirect(`/admin/login?lang=${language}`);
	const copy = getCopy(language);
	const data = await getConsoleData((page - 1) * 50, 50, filters);
	return (
		<div className="admin-page">
			<AdminHeader copy={copy} language={language} current="queue" />
			<section className="admin-heading"><div><h1>{copy.admin.title}</h1><p>{copy.admin.subtitle}</p></div><span><i />{copy.admin.live}</span></section>
			<AdminWorkspace key={`${page}-${data.checkedAt}`} initialData={data} copy={copy} language={language} filters={filters} />
		</div>
	);
}
