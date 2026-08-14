/*
THESIS: A focused product showroom lets customers understand one item and act without crossing into staff operations.
OWN-WORLD: Paper-white retail surface, black structure, lime for confirmed actions, and a deep-blue product field.
STORY: See the product, verify the key facts, add it to the cart, and reach authenticated support when needed.
FIRST VIEWPORT: Product promise and buying actions left; a precise device study right.
FORM: Single-product showroom in the established Proof Studio system.
*/
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ProductActions } from "@/components/product-actions";
import { SiteHeader } from "@/components/site-header";
import { getProducts } from "@/lib/api";
import { formatThb } from "@/lib/catalog";
import { getCopy, parseLanguage } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "iPhone 17 Pro Max",
  description: "ดูข้อมูล iPhone 17 Pro Max เพิ่มลงตะกร้า และติดต่อทีม ServicePilot",
};
export const dynamic = "force-dynamic";

export default async function StorefrontPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const language = parseLanguage((await searchParams).lang);
  const copy = getCopy(language);
  const product = (await getProducts())[0];

  if (!product) return <div className="storefront-page"><SiteHeader language={language} copy={copy} route="/" /><main className="storefront-main"><section className="cart-empty"><h1>{copy.commerce.empty}</h1><p>Catalog is being prepared. Please check back soon.</p></section></main></div>;

  return (
    <div className="storefront-page">
      <SiteHeader language={language} copy={copy} route="/" />
      <main className="storefront-main">
        <section className="product-hero" aria-labelledby="product-title">
          <div className="product-copy">
            <p className="section-label">{copy.commerce.label}</p>
            <h1 id="product-title">{product.name}</h1>
            <p className="product-subtitle">{copy.commerce.subtitle}</p>
            <div className="product-meta"><span>{product.variant}</span><small>{copy.commerce.availability}</small></div>
            <div className="product-price"><strong>{formatThb(product.priceThb, language)}</strong><span>{copy.commerce.priceNote}</span></div>
            <ProductActions productId={product.id} language={language} copy={copy} />
          </div>
          <figure className="product-visual">
            <Image className="product-image" src={product.imageUrl} alt={`${product.name} ${product.variant}, front and back view`} width={1600} height={900} priority sizes="(max-width: 760px) 100vw, 58vw" />
            <figcaption className="sr-only">{product.name}, {product.variant}</figcaption>
          </figure>
        </section>

        <section className="product-facts" aria-label={copy.commerce.details}>
          {copy.commerce.features.map((feature) => <span key={feature}>{feature}</span>)}
        </section>

        <section className="product-notes">
          <div className="purchase-process"><h2>{copy.commerce.processTitle}</h2><p>{copy.commerce.processIntro}</p><ol>{copy.commerce.processSteps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></div>
          <aside><p>{copy.commerce.disclosure}</p>{product.sourceUrl ? <Link href={product.sourceUrl} target="_blank" rel="noreferrer">{copy.commerce.sourceLink}<span aria-hidden="true">↗</span></Link> : null}<small>{copy.commerce.source}</small></aside>
        </section>
      </main>
    </div>
  );
}
