/**
 * Checkout: turn an active hold into an order and start payment.
 *
 *  - Collects buyer contact details (stored on the order only).
 *  - Free baskets (total 0) are confirmed immediately.
 *  - Paid baskets get a payment attempt with the provider's HOSTED checkout.
 *    The browser comes back to the private order page, which only DISPLAYS
 *    status. Confirmation happens when the verified webhook arrives.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { allocations, holds, inventoryItems, orderLines, orders, paymentAttempts } from "@/db/schema";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit";
import { decryptToken, encryptToken, hashToken, newBookingReference, newToken } from "@/server/tokens";
import { getPaymentProvider } from "@/server/payments/provider";
import { lockEvent } from "./holds";
import { confirmOrderInTx } from "./confirm";

export const checkoutInput = z.object({
  buyerName: z.string().trim().min(1).max(120),
  buyerEmail: z.string().trim().toLowerCase().email().max(200),
  buyerPhone: z
    .string()
    .trim()
    .max(30)
    .regex(/^\+?[0-9 ()-]{6,30}$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  whatsappOptIn: z.boolean().default(false),
});
export type CheckoutInput = z.infer<typeof checkoutInput>;

export type CheckoutResult = {
  orderId: string;
  bookingReference: string;
  /** Private buyer link: /o/<token>. Treat like a password. */
  orderPath: string;
  /** Where to send the browser next (hosted checkout or the order page). */
  redirectUrl: string;
  state: "confirmed" | "pending_payment";
};

export async function startCheckout(holdId: string, rawInput: unknown): Promise<CheckoutResult> {
  const input = checkoutInput.parse(rawInput);

  const created = await db().transaction(async (tx) => {
    const [peek] = await tx.select({ eventId: holds.eventId }).from(holds).where(eq(holds.id, holdId));
    if (!peek) throw new AppError("not_found", "Basket not found");
    await lockEvent(tx, peek.eventId);

    const [hold] = await tx.select().from(holds).where(eq(holds.id, holdId)).for("update");
    const [existing] = await tx.select().from(orders).where(eq(orders.holdId, holdId));
    if (existing) {
      // Re-submitting the form: reuse the order instead of creating a second one.
      if (existing.state !== "pending_payment" && existing.state !== "confirmed") {
        throw new AppError("hold_expired", "This basket can no longer be checked out");
      }
      return { order: existing, token: decryptToken(existing.accessTokenEncrypted), isNew: false };
    }

    const [stillActive] = await tx
      .select({ id: holds.id })
      .from(holds)
      .where(and(eq(holds.id, holdId), eq(holds.state, "active"), gt(holds.expiresAt, sql`now()`)));
    if (!stillActive) throw new AppError("hold_expired", "Your reservation time ran out. Please choose again.");

    const lines = await tx.select().from(allocations).where(eq(allocations.holdId, holdId));
    const token = newToken();
    const [order] = await tx
      .insert(orders)
      .values({
        clubId: hold.clubId,
        eventId: hold.eventId,
        holdId: hold.id,
        bookingReference: newBookingReference(),
        buyerName: input.buyerName,
        buyerEmail: input.buyerEmail,
        buyerPhone: input.buyerPhone ?? null,
        whatsappOptIn: input.whatsappOptIn,
        currency: hold.currency,
        totalMinor: hold.totalMinor,
        accessTokenHash: hashToken(token),
        accessTokenEncrypted: encryptToken(token),
      })
      .returning();

    await tx.update(allocations).set({ orderId: order.id }).where(eq(allocations.holdId, holdId));
    for (const a of lines) {
      const [item] = await tx
        .select({ label: inventoryItems.label, ticketTypeId: inventoryItems.ticketTypeId })
        .from(inventoryItems)
        .where(eq(inventoryItems.id, a.inventoryItemId));
      await tx.insert(orderLines).values({
        clubId: order.clubId,
        orderId: order.id,
        inventoryItemId: a.inventoryItemId,
        ticketTypeId: item.ticketTypeId,
        label: item.label,
        quantity: a.quantity,
        unitPriceMinor: a.unitPriceMinor,
        admissions: a.admissions,
        lineTotalMinor: a.unitPriceMinor * a.quantity,
      });
    }

    await audit(tx, {
      clubId: order.clubId,
      actorType: "guest",
      action: "order.created",
      entityType: "order",
      entityId: order.id,
      data: { totalMinor: order.totalMinor },
    });

    if (order.totalMinor === 0) {
      await confirmOrderInTx(tx, order, { type: "guest" });
      return { order: { ...order, state: "confirmed" as const }, token, isNew: true };
    }
    return { order, token, isNew: true };
  });

  const orderPath = `/o/${created.token}`;
  const base = {
    orderId: created.order.id,
    bookingReference: created.order.bookingReference,
    orderPath,
  };
  if (created.order.state === "confirmed") {
    return { ...base, redirectUrl: orderPath, state: "confirmed" };
  }

  // Paid basket: start (or restart) hosted checkout. Network calls to a real
  // provider happen OUTSIDE the inventory transaction on purpose.
  const provider = getPaymentProvider();
  const merchantId = provider.merchantIdForClub(created.order.clubId);
  const session = await provider.createCheckout({
    orderId: created.order.id,
    bookingReference: created.order.bookingReference,
    amountMinor: created.order.totalMinor,
    currency: created.order.currency,
    merchantId,
    returnUrl: orderPath,
  });
  await db().transaction(async (tx) => {
    await tx
      .update(paymentAttempts)
      .set({ state: "superseded", updatedAt: sql`now()` })
      .where(and(eq(paymentAttempts.orderId, created.order.id), eq(paymentAttempts.state, "created")));
    await tx.insert(paymentAttempts).values({
      clubId: created.order.clubId,
      orderId: created.order.id,
      provider: provider.name,
      providerSessionId: session.providerSessionId,
      merchantId,
      amountMinor: created.order.totalMinor,
      currency: created.order.currency,
    });
  });

  return { ...base, redirectUrl: session.redirectUrl, state: "pending_payment" };
}
