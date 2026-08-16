import Link from "next/link";

import { AdminLogout } from "@/components/admin-logout";
import { LanguageSwitch } from "@/components/language-switch";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";

type Props = { copy: Copy; language: Language; current: "queue" | "audit" };

export function AdminHeader({ copy, language, current }: Props) {
	const query = `?lang=${language}`;
	return (
		<header className="admin-topbar">
			<Link className="wordmark" href={`/admin${query}`}><span aria-hidden="true">✳</span><strong>ServicePilot</strong><em>ADMIN</em></Link>
			<nav className="admin-nav" aria-label={copy.nav.admin}>
				<Link className="route-link" aria-current={current === "queue" ? "page" : undefined} href={`/admin${query}`}>{copy.nav.admin}</Link>
				<Link className="route-link" aria-current={current === "audit" ? "page" : undefined} href={`/admin/audit${query}`}>{copy.nav.audit}</Link>
			</nav>
			<div className="admin-actions">
				<LanguageSwitch language={language} path={current === "audit" ? "/admin/audit" : "/admin"} label={copy.language.label} />
				<AdminLogout label={copy.nav.logout} language={language} />
			</div>
		</header>
	);
}
