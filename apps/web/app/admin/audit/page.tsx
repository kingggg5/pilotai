import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminHeader } from "@/components/admin-header";
import { hasAdminSession } from "@/lib/admin-auth";
import { getAuditEvents } from "@/lib/api";
import { auditActions, auditPageUrl, humanizeAuditValue, parseAuditFilters, type AuditSearch } from "@/lib/audit-filters";
import { getCopy, parseLanguage } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<AuditSearch> }) {
  const params = await searchParams;
  const language = parseLanguage(params.lang);
  if (!await hasAdminSession()) redirect(`/admin/login?lang=${language}`);
  const copy = getCopy(language);
  const parsed = parseAuditFilters(params);
  const data = await getAuditEvents(parsed.filters);

  return (
    <div className="admin-page">
      <AdminHeader copy={copy} language={language} current="audit" />
      <main className="audit-main">
        <section className="admin-heading audit-heading">
          <div><h1>{copy.audit.title}</h1><p>{copy.audit.subtitle}</p></div>
          <span><i />{copy.audit.showing}</span>
        </section>

        <form className="audit-filters" method="get">
          <input type="hidden" name="lang" value={language} />
          <strong>{copy.audit.filter}</strong>
          <label>{copy.audit.action}
            <select name="action" defaultValue={parsed.action || ""}>
              <option value="">{copy.audit.allActions}</option>
              {auditActions.map((action) => <option key={action} value={action}>{humanizeAuditValue(action)}</option>)}
            </select>
          </label>
          <label>{copy.audit.outcome}
            <select name="outcome" defaultValue={parsed.outcome || ""}>
              <option value="">{copy.audit.allOutcomes}</option>
              <option value="success">{copy.audit.success}</option>
              <option value="denied">{copy.audit.denied}</option>
              <option value="failure">{copy.audit.failure}</option>
            </select>
          </label>
          <label>{copy.audit.resource}
            <input name="resource" defaultValue={parsed.resource || ""} placeholder={copy.audit.resourcePlaceholder} autoComplete="off" />
          </label>
          <div className="audit-filter-actions">
            <button className="primary-button" type="submit">{copy.audit.apply}<span aria-hidden="true">→</span></button>
            <Link href={`/admin/audit?lang=${language}`}>{copy.audit.clear}</Link>
          </div>
        </form>

        {data.loadError ? (
          <section className="audit-empty" role="alert"><strong>{copy.audit.unavailable}</strong><p>{data.loadError}</p></section>
        ) : data.items.length === 0 ? (
          <section className="audit-empty"><strong>{copy.audit.empty}</strong></section>
        ) : (
          <section className="audit-list" aria-label={copy.audit.title}>
            <div className="audit-list-head" aria-hidden="true"><span>{copy.audit.time}</span><span>{copy.audit.action}</span><span>{copy.audit.actor}</span><span>{copy.audit.target}</span><span>{copy.audit.outcome}</span></div>
            {data.items.map((event) => (
              <article className="audit-row" key={event.id}>
                <time dateTime={event.occurredAt}>{new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</time>
                <strong>{humanizeAuditValue(event.action)}</strong>
                <span><b>{event.actorId}</b><small>{event.actorType}</small></span>
                <span><b>{event.resourceId || "—"}</b><small>{event.resourceType}</small></span>
                <span className={`audit-outcome outcome-${event.outcome}`}>{copy.audit[event.outcome]}</span>
                <details>
                  <summary>{copy.audit.details}</summary>
                  <dl>
                    {event.requestId && <div><dt>{copy.audit.request}</dt><dd>{event.requestId}</dd></div>}
                    {Object.entries(event.metadata).map(([key, value]) => <div key={key}><dt>{humanizeAuditValue(key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}
                  </dl>
                </details>
              </article>
            ))}
          </section>
        )}

        {data.nextCursor && <Link className="audit-next" href={auditPageUrl(language, parsed, data.nextCursor)}>{copy.audit.next}<span aria-hidden="true">↓</span></Link>}
      </main>
    </div>
  );
}
