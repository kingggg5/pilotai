import { z } from "zod";

export const ErrorResponse = z.object({ detail: z.string(), code: z.string() });
export const ThreadParams = z.object({ threadId: z.string().min(1).max(128) });
export const QueueQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(200).default(""),
  number: z.string().trim().max(128).default(""),
  priority: z.enum(["low", "normal", "high", "urgent", ""]).default(""),
  status: z.enum(["new", "investigating", "needs_approval", "draft_ready", "resolved", ""]).default(""),
  channel: z.enum(["email", "chat", "web", ""]).default(""),
  handling_mode: z.enum(["manual", "copilot", "autopilot", ""]).default(""),
  created_from: z.string().date().or(z.literal("")).default(""),
  created_to: z.string().date().or(z.literal("")).default(""),
  sort: z.enum(["newest", "oldest", "priority"]).default("newest"),
});
export const TicketParams = z.object({ ticketId: z.string().min(1).max(128) });
