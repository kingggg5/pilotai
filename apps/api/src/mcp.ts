import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { buildContainer } from "./container.js";
import { loadSettings } from "./config.js";

const container = await buildContainer(loadSettings());
const server = new McpServer({ name: "servicepilot-tools", version: container.settings.APP_VERSION });
const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> });

server.registerTool("get_order_status", { description: "Read the current order status. Read-only.", inputSchema: z.object({ order_id: z.string(), customer_id: z.string().optional(), tenant_id: z.string().optional() }) }, async ({ order_id, tenant_id }) => result(await container.tools.getOrderStatus(order_id, tenant_id ?? "tenant-local")));
server.registerTool("check_refund_status", { description: "Read the current refund status. Read-only.", inputSchema: z.object({ order_id: z.string(), tenant_id: z.string().optional() }) }, async ({ order_id, tenant_id }) => result(await container.tools.getRefundStatus(order_id, tenant_id ?? "tenant-local")));
server.registerTool("search_policy", { description: "Search authorized support policies with page citations. Read-only.", inputSchema: z.object({ query: z.string(), top_k: z.number().int().min(1).max(10).default(3), tenant_id: z.string().default("tenant-local") }) }, async ({ query, top_k, tenant_id }) => result(await container.tools.searchPolicy(query, top_k, tenant_id, [])));
server.registerTool("create_escalation", { description: "Write boundary. Escalations must be approved through the authenticated REST workflow; this transport fails closed.", inputSchema: z.object({ thread_id: z.string(), tenant_id: z.string() }) }, async () => ({ content: [{ type: "text", text: "Human approval is required through POST /api/v1/runs/{thread_id}/decision." }], isError: true }));

process.once("SIGINT", () => void container.close());
process.once("SIGTERM", () => void container.close());
await server.connect(new StdioServerTransport());
