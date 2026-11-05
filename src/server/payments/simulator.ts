/**
 * Payment SIMULATOR. Test mode only. No money moves.
 *
 * It behaves like a hosted gateway: checkout happens on "its" page
 * (/simulator/[sessionId]) and results arrive as HMAC-signed webhook events,
 * so the real confirmation code path (signature check, dedupe, amount check)
 * is exercised end to end.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@/server/errors";
import type { CreateCheckoutInput, PaymentProvider, VerifiedProviderEvent } from "./provider";

export const SIMULATOR_SIGNATURE_HEADER = "x-simulator-signature";

function secret() {
  const s = process.env.PAYMENT_SIMULATOR_SECRET;
  if (!s || s.length < 16) throw new Error("PAYMENT_SIMULATOR_SECRET must be set (16+ chars)");
  return s;
}

export function signSimulatorBody(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("hex");
}

export type SimulatorEventBody = {
  id: string;
  type: "payment.succeeded" | "payment.failed";
  session_id: string;
  merchant_id: string;
  amount_minor: number;
  currency: string;
};

/** Build a signed event exactly as the "provider" would send it. */
export function buildSimulatorEvent(e: Omit<SimulatorEventBody, "id"> & { id?: string }) {
  const { id, ...rest } = e;
  const body = JSON.stringify({ ...rest, id: id ?? `evt_${randomBytes(12).toString("hex")}` });
  return { body, signature: signSimulatorBody(body) };
}

export const simulatorProvider: PaymentProvider = {
  name: "simulator",

  merchantIdForClub(clubId: string) {
    return `sim_merchant_${clubId}`;
  },

  async createCheckout(input: CreateCheckoutInput) {
    const providerSessionId = `sim_${randomBytes(16).toString("hex")}`;
    void input;
    return { providerSessionId, redirectUrl: `/simulator/${providerSessionId}` };
  },

  async parseWebhook(rawBody: string, headers: Headers): Promise<VerifiedProviderEvent> {
    const given = headers.get(SIMULATOR_SIGNATURE_HEADER) ?? "";
    const expected = signSimulatorBody(rawBody);
    const a = Buffer.from(given, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError("invalid_signature", "Invalid webhook signature");
    }
    let parsed: SimulatorEventBody;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new AppError("validation", "Malformed webhook body");
    }
    if (parsed.type !== "payment.succeeded" && parsed.type !== "payment.failed") {
      throw new AppError("validation", "Unsupported event type");
    }
    return {
      providerEventId: String(parsed.id),
      type: parsed.type,
      providerSessionId: String(parsed.session_id),
      merchantId: String(parsed.merchant_id),
      amountMinor: Number(parsed.amount_minor),
      currency: String(parsed.currency),
      raw: parsed,
    };
  },
};
