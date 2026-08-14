import type { Metadata } from "next";

import { CartView } from "@/components/cart-view";
import { SiteHeader } from "@/components/site-header";
import { getCopy, parseLanguage } from "@/lib/i18n";
import { getCustomerSession } from "@/lib/customer-auth";
import { getProducts } from "@/lib/api";

export const metadata: Metadata = { title: "Cart" };
export const dynamic = "force-dynamic";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const language = parseLanguage((await searchParams).lang);
  const copy = getCopy(language);
  return <div className="cart-page"><SiteHeader language={language} copy={copy} route="/cart" /><main className="cart-main"><CartView language={language} copy={copy} signedIn={Boolean(await getCustomerSession())} products={await getProducts()} /></main></div>;
}
