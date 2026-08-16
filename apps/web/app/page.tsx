/*
THESIS: A focused product showroom lets customers understand one item and act without crossing into staff operations.
OWN-WORLD: Paper-white retail surface, black structure, lime for confirmed actions, and a deep-blue product field.
STORY: See the product, verify the key facts, add it to the cart, and reach authenticated support when needed.
FIRST VIEWPORT: Product promise and buying actions left; a precise device study right.
FORM: Single-product showroom in the established Proof Studio system.
*/
import type { Metadata } from "next";
import Image from "next/image";
import { ProductActions } from "@/components/product-actions";
import { SiteHeader } from "@/components/site-header";
import { getProducts } from "@/lib/api";
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
						<ProductActions productId={product.id} language={language} copy={copy} basePrice={product.priceThb} />
					</div>
					<figure className="product-visual">
						<Image className="product-image" src={product.imageUrl} alt={`${product.name} ${product.variant}, front and back view`} width={1600} height={900} priority sizes="(max-width: 760px) 100vw, 58vw" />
						<figcaption className="sr-only">{product.name}, {product.variant}</figcaption>
					</figure>
				</section>

				<section className="product-facts" aria-label={copy.commerce.details}>
					{copy.commerce.features.map((feature) => (
						<div key={feature} className="product-fact-card">
							<span className="fact-dot" aria-hidden="true" />
							<strong>{feature}</strong>
						</div>
					))}
				</section>
			</main>
		</div>
	);
}
