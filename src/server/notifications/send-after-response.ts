/**
 * Send a confirmed order's notifications straight after the HTTP response,
 * so the guest gets their email within seconds without waiting for the worker.
 *
 * Uses Next.js `after()`: the guest's response is never delayed or failed by
 * email problems. Anything that fails stays queued for `npm run worker:notifications`.
 * Only call this from Route Handlers / Server Functions (needs a request context).
 */
import { after } from "next/server";
import { smtpSender } from "./email";
import { sendNotificationsForOrder } from "./worker";

export function sendNotificationsAfterResponse(orderId: string) {
  after(() => sendNotificationsForOrder(orderId, smtpSender()));
}
