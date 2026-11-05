/**
 * POST /api/payments/webhooks/:provider
 * The ONLY way an order becomes paid. The provider adapter verifies the
 * signature over the raw body before we trust anything in it.
 */
import { getPaymentProvider } from "@/server/payments/provider";
import { processProviderEvent } from "@/server/payments/process-event";
import { handle } from "@/server/http";
import { sendNotificationsAfterResponse } from "@/server/notifications/send-after-response";

export async function POST(req: Request, ctx: RouteContext<"/api/payments/webhooks/[provider]">) {
  const { provider: name } = await ctx.params;
  const raw = await req.text();
  return handle(async () => {
    const provider = getPaymentProvider(name);
    const event = await provider.parseWebhook(raw, req.headers);
    const result = await processProviderEvent(provider.name, event);
    // The confirmation transaction has committed by now; email the guest.
    if ((result.outcome === "confirmed" || result.outcome === "confirmed_late") && result.orderId) {
      sendNotificationsAfterResponse(result.orderId);
    }
    return { received: true, outcome: result.outcome };
  });
}
