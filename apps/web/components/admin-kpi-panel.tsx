import type { Copy } from "@/lib/i18n";
import type { KpiAnalytics, Language } from "@/lib/types";

export function AdminKpiPanel({ kpi, copy, language }: { kpi: KpiAnalytics; copy: Copy; language: Language }) {
	const locale = language === "th" ? "th-TH" : "en-GB";
	const count = (value: number) => value.toLocaleString(locale);
	const percent = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
	const metrics = [
		{ label: copy.admin.kpi.total, value: count(kpi.totalTickets) },
		{ label: copy.admin.kpi.resolved, value: count(kpi.resolvedTickets) },
		{ label: copy.admin.kpi.zeroTouch, value: percent(kpi.zeroTouchRate) },
		{ label: copy.admin.kpi.humanAssisted, value: percent(kpi.humanAssistedRate) },
		{ label: copy.admin.kpi.avgConfidence, value: percent(Math.round(kpi.avgConfidence * 100)) },
		{ label: copy.admin.kpi.hoursSaved, value: kpi.estimatedHoursSaved.toLocaleString(locale, { maximumFractionDigits: 1 }) },
		{ label: copy.admin.kpi.costSaved, value: `฿${count(kpi.estimatedCostSavedThb)}` },
		{ label: copy.admin.kpi.csat, value: `${kpi.csatScore.toLocaleString(locale, { maximumFractionDigits: 1 })}/5` },
	];

	return (
		<section className="admin-kpi" aria-label={copy.admin.kpi.title}>
			<div className="admin-kpi-heading"><span className="ai-live-dot" aria-hidden="true" /><strong>{copy.admin.kpi.title}</strong></div>
			<dl>{metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>
		</section>
	);
}
