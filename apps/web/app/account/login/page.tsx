import { redirect } from "next/navigation";
import { CustomerAuthForm } from "@/components/customer-auth-form";
import { SiteHeader } from "@/components/site-header";
import { getCustomerSession } from "@/lib/customer-auth";
import { customerReturnPath, localizedPath } from "@/lib/customer-return";
import { getCopy, parseLanguage } from "@/lib/i18n";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string; next?: string }> }) {
  const query = await searchParams;
  const language = parseLanguage(query.lang);
  const nextPath = customerReturnPath(query.next);
  if (await getCustomerSession()) redirect(localizedPath(nextPath, language));
  const copy = getCopy(language);
  return <div className="account-auth-page"><SiteHeader language={language} copy={copy} route="/account/login" /><main className="account-auth-main"><CustomerAuthForm mode="login" language={language} copy={copy} nextPath={nextPath} /></main></div>;
}
