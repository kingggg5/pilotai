import Link from "next/link";

import { CartLink } from "@/components/cart-link";
import { LanguageSwitch } from "@/components/language-switch";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";
import { getCustomerSession } from "@/lib/customer-auth";

export async function SiteHeader({ language, copy, route, admin = false }: {
	language: Language;
	copy: Copy;
	route: string;
	admin?: boolean;
}) {
	const customer = await getCustomerSession();
	return (
		<header className={admin ? "site-header admin-header" : "site-header"}>
			<Link className="wordmark" href={`/?lang=${language}`} aria-label="ServicePilot AI">
				<span aria-hidden="true">✳</span><strong>ServicePilot</strong>
			</Link>
			{!admin ? (
				<nav className="customer-nav" aria-label={language === "th" ? "เมนูลูกค้า" : "Customer navigation"}>
					<Link className="route-link" aria-current={route === "/" ? "page" : undefined} href={`/?lang=${language}`}>{copy.nav.shop}</Link>
					<Link className="route-link" aria-current={route === "/support" ? "page" : undefined} href={`/support?lang=${language}`}>{copy.nav.support}</Link>
					<CartLink language={language} label={copy.nav.cart} current={route === "/cart"} />
					<Link className="route-link account-link" aria-current={route.startsWith("/account") ? "page" : undefined} href={`${customer ? "/account" : "/account/login"}?lang=${language}`}>{customer ? copy.nav.account : copy.nav.login}</Link>
				</nav>
			) : null}
			<div className="header-actions">
				{admin ? <Link className="route-link" href={`/?lang=${language}`}>{copy.nav.shop}</Link> : null}
				<LanguageSwitch language={language} path={route} label={copy.language.label} />
			</div>
		</header>
	);
}
