/**
 * POST /api/payments/webhooks/:provider
 * The ONLY way an order becomes paid. The provider adapter verifies the
 * signature over the raw body before we trust anything in it.
 */
import { getPaymentProvider } from "@/server/payments/provider";
import { processProviderEvent } from "@/server/payments/process-event";
import { handle } from "@/server/http";

export async function POST(req: Request, ctx: RouteContext<"/api/payments/webhooks/[provider]">) {
  const { provider: name } = await ctx.params;
  const raw = await req.text();
  return handle(async () => {
    const provider = getPaymentProvider(name);
    const event = await provider.parseWebhook(raw, req.headers);
    const result = await processProviderEvent(provider.name, event);
    return { received: true, outcome: result.outcome };
  });
}
