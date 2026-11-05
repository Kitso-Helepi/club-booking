/**
 * Payment provider adapter.
 *
 * The rest of the app only talks to this interface. To add a real gateway later,
 * implement it with HOSTED checkout (the provider's page collects card details,
 * never ours) and register it in `getPaymentProvider()`.
 *
 * Rules every provider implementation must follow:
 *  - `parseWebhook` verifies the signature and throws AppError("invalid_signature") otherwise.
 *  - Payment is confirmed ONLY from a verified webhook, never from the browser redirect.
 */
import { AppError } from "@/server/errors";
import { simulatorProvider } from "./simulator";

export type CreateCheckoutInput = {
  orderId: string;
  bookingReference: string;
  amountMinor: number;
  currency: string;
  merchantId: string;
  /** Where the provider sends the guest afterwards (shows status only). */
  returnUrl: string;
};

export type VerifiedProviderEvent = {
  providerEventId: string;
  type: "payment.succeeded" | "payment.failed";
  providerSessionId: string;
  merchantId: string;
  amountMinor: number;
  currency: string;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  /** Merchant account id we expect for a club. */
  merchantIdForClub(clubId: string): string;
  createCheckout(input: CreateCheckoutInput): Promise<{ providerSessionId: string; redirectUrl: string }>;
  parseWebhook(rawBody: string, headers: Headers): Promise<VerifiedProviderEvent>;
}

export function getPaymentProvider(name?: string): PaymentProvider {
  const selected = name ?? process.env.PAYMENT_PROVIDER ?? "simulator";
  if (selected === "simulator") {
    assertSimulatorAllowed();
    return simulatorProvider;
  }
  throw new AppError("not_found", `Unknown payment provider: ${selected}`);
}

/** The simulator must never be reachable when real money is involved. */
export function assertSimulatorAllowed() {
  if ((process.env.PAYMENTS_MODE ?? "test") !== "test") {
    throw new AppError("not_allowed_in_mode", "The payment simulator is disabled in live mode");
  }
}
