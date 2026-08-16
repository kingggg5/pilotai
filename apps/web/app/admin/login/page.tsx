import { redirect } from "next/navigation";

import { AdminLogin } from "@/components/admin-login";
import { SiteHeader } from "@/components/site-header";
import { adminAuthConfigured, hasAdminSession } from "@/lib/admin-auth";
import { getCopy, parseLanguage } from "@/lib/i18n";
import { ssoConfigured } from "@/lib/sso-auth";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
	const language = parseLanguage((await searchParams).lang);
	if (await hasAdminSession()) redirect(`/admin?lang=${language}`);
	const copy = getCopy(language);
	return <div className="login-page"><SiteHeader language={language} copy={copy} route="/admin/login" admin /><AdminLogin copy={copy} language={language} configured={adminAuthConfigured()} ssoEnabled={ssoConfigured()} /></div>;
}
