import type { FastifyRequest } from "fastify";

import type { AppContainer } from "../container.js";
import type { Principal } from "../domain.js";
import { principalFor } from "../security.js";

declare module "fastify" {
	interface FastifyRequest {
		principal: Principal | null;
	}
}

export function routeContext(container: AppContainer) {
	const authenticate = async (request: FastifyRequest) => {
		request.principal = await principalFor(request, container.settings);
	};
	const principal = (request: FastifyRequest) => {
		if (!request.principal) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
		return request.principal;
	};
	return { authenticate, principal };
}
