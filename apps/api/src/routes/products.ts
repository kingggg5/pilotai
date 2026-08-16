import type { FastifyInstance } from "fastify";
import { type ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { AppContainer } from "../container.js";
import { AuditActions } from "../audit.js";
import { CatalogProduct } from "../domain.js";
import { requireRole } from "../security.js";
import { routeContext } from "./context.js";

/** Public catalogue read. Product truth lives in catalog_products, never in the web bundle. */
export async function registerProductRoutes(app: FastifyInstance, container: AppContainer) {
	app.get("/api/v1/products", { schema: { tags: ["catalog"], response: { 200: z.object({ items: z.array(CatalogProduct) }) } } }, async () => ({ items: await container.products.list("*") }));
	const api = app.withTypeProvider<ZodTypeProvider>();
	const { authenticate, principal } = routeContext(container);
	api.put("/api/v1/catalog/products/:productId", { preHandler: authenticate, schema: { tags: ["catalog"], params: z.object({ productId: z.string().min(1).max(128) }), body: CatalogProduct.omit({ id: true }), response: { 200: CatalogProduct } } }, async (request) => {
		const actor = principal(request);
		requireRole(actor, ["agent", "supervisor"], "Agent role required");
		const product = CatalogProduct.parse({ ...request.body, id: request.params.productId });
		await container.products.upsert(product, actor.tenant_id);
		await container.audit.fromRequest(request, actor, { action: AuditActions.catalogUpdated, resourceType: "catalog_product", resourceId: product.id, metadata: { active: product.active, currency: product.currency } });
		return product;
	});
}
