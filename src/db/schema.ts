/**
 * Database schema (Drizzle ORM).
 *
 * Reading guide for students:
 *  - Every club-owned table has a `club_id`. Staff queries MUST filter by it.
 *  - Money is always an integer in currency minor units (cents): `*_minor`.
 *  - State columns use Postgres enums so invalid states cannot be stored.
 *  - Visual floor-plan geometry lives in `layout_versions.geometry` (JSON).
 *    Availability is controlled ONLY by `inventory_items` + `allocations`.
 *  - Change this file, then run `npm run db:generate` to create a migration.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Better Auth core tables (staff authentication only).               */
/* Column names follow Better Auth's default schema.                  */
/* ------------------------------------------------------------------ */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* ------------------------------------------------------------------ */
/* Clubs, venues, staff                                               */
/* ------------------------------------------------------------------ */

export const staffRole = pgEnum("staff_role", ["owner", "manager", "door"]);

export const clubs = pgTable("clubs", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("ZAR"),
  createdAt: createdAt(),
});

export const clubMemberships = pgTable(
  "club_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: staffRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("club_memberships_club_user_uq").on(t.clubId, t.userId)],
);

export const venues = pgTable("venues", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  /** IANA time zone, e.g. Africa/Johannesburg. All event times display in this zone. */
  timezone: text("timezone").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Events, layouts, inventory                                         */
/* ------------------------------------------------------------------ */

export const eventStatus = pgEnum("event_status", ["draft", "published", "cancelled"]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    entryPolicy: text("entry_policy").notNull().default(""),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    status: eventStatus("status").notNull().default("draft"),
    currency: text("currency").notNull(),
    /** Every admission (GA, seat, table pass) counts toward this cap. */
    admissionCap: integer("admission_cap").notNull(),
    /** The layout version guests currently see (set when a version is published). */
    publishedLayoutVersionId: uuid("published_layout_version_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("events_club_slug_uq").on(t.clubId, t.slug),
    check("events_admission_cap_positive", sql`${t.admissionCap} > 0`),
  ],
);

export const eventStaffAssignments = pgTable(
  "event_staff_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("event_staff_event_user_uq").on(t.eventId, t.userId)],
);

/** A named floor plan. venue-level template when event_id is null, otherwise an event's own copy. */
export const layouts = pgTable("layouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  venueId: uuid("venue_id")
    .notNull()
    .references(() => venues.id),
  eventId: uuid("event_id").references(() => events.id),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const layoutVersionState = pgEnum("layout_version_state", ["draft", "published", "superseded"]);

export const layoutVersions = pgTable(
  "layout_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    layoutId: uuid("layout_id")
      .notNull()
      .references(() => layouts.id),
    version: integer("version").notNull(),
    state: layoutVersionState("state").notNull().default("draft"),
    /** Visual geometry only. See src/domain/layout.ts for the shape. */
    geometry: jsonb("geometry").notNull(),
    createdBy: text("created_by").references(() => user.id),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("layout_versions_layout_version_uq").on(t.layoutId, t.version)],
);

export const inventoryKind = pgEnum("inventory_kind", ["general_admission", "seat", "table"]);

/** Price category. Prices are only ever read from here by the server. */
export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    /** Stable key referenced by layout objects, e.g. "vip-table". */
    key: text("key").notNull(),
    kind: inventoryKind("kind").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMinor: integer("price_minor").notNull(),
    /** Admission passes issued per unit (a 6-person table = 6). */
    admissionsPerUnit: integer("admissions_per_unit").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ticket_types_event_key_uq").on(t.eventId, t.key),
    check("ticket_types_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("ticket_types_admissions_positive", sql`${t.admissionsPerUnit} > 0`),
  ],
);

export const inventoryStatus = pgEnum("inventory_status", ["active", "unavailable", "retired"]);

/**
 * One row per bookable thing for an event:
 *  - table / seat: capacity = 1 unit, booked exclusively.
 *  - general_admission: a pool; capacity = number of units in the pool.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    kind: inventoryKind("kind").notNull(),
    /** Matches a layout object's key (null for GA pools). Stable across layout versions. */
    objectKey: text("object_key"),
    /** Zone this item sits in. A zone is either seats-only or tables-only per event. */
    zoneKey: text("zone_key"),
    label: text("label").notNull(),
    capacity: integer("capacity").notNull().default(1),
    status: inventoryStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("inventory_items_event_object_uq").on(t.eventId, t.objectKey),
    index("inventory_items_event_idx").on(t.eventId),
    check("inventory_items_capacity_positive", sql`${t.capacity} > 0`),
    check(
      "inventory_items_exclusive_capacity_one",
      sql`${t.kind} = 'general_admission' OR ${t.capacity} = 1`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Holds, orders, allocations                                         */
/* ------------------------------------------------------------------ */

export const holdState = pgEnum("hold_state", ["active", "converted", "released", "expired"]);

export const holds = pgTable(
  "holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    state: holdState("state").notNull().default("active"),
    expiresAt: ts("expires_at").notNull(),
    currency: text("currency").notNull(),
    totalMinor: integer("total_minor").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("holds_event_idx").on(t.eventId)],
);

export const orderState = pgEnum("order_state", [
  "pending_payment",
  "confirmed",
  "payment_failed",
  "expired",
  "cancelled",
  "needs_reconciliation",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    holdId: uuid("hold_id")
      .notNull()
      .references(() => holds.id),
    /** Public support reference (e.g. CB-7KQ4M2). Grants NO access on its own. */
    bookingReference: text("booking_reference").notNull().unique(),
    state: orderState("state").notNull().default("pending_payment"),
    buyerName: text("buyer_name").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    buyerPhone: text("buyer_phone"),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    currency: text("currency").notNull(),
    totalMinor: integer("total_minor").notNull(),
    /** SHA-256 of the private order-link token (lookup). */
    accessTokenHash: text("access_token_hash").notNull().unique(),
    /** AES-GCM encrypted token so staff resends can rebuild the link. */
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_hold_uq").on(t.holdId),
    index("orders_club_event_idx").on(t.clubId, t.eventId),
    check("orders_total_nonneg", sql`${t.totalMinor} >= 0`),
  ],
);

export const orderLines = pgTable("order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id),
  ticketTypeId: uuid("ticket_type_id")
    .notNull()
    .references(() => ticketTypes.id),
  label: text("label").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: integer("unit_price_minor").notNull(),
  admissions: integer("admissions").notNull(),
  lineTotalMinor: integer("line_total_minor").notNull(),
});

export const allocationState = pgEnum("allocation_state", ["held", "confirmed", "released", "expired", "cancelled"]);

/**
 * The record that actually takes inventory.
 * A held allocation only counts while `expires_at > now()`, so availability is
 * correct even if the cleanup sweep runs late.
 */
export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id),
    holdId: uuid("hold_id")
      .notNull()
      .references(() => holds.id),
    orderId: uuid("order_id").references(() => orders.id),
    /** true for seats and tables: at most one active allocation per item. */
    exclusive: boolean("exclusive").notNull(),
    quantity: integer("quantity").notNull(),
    admissions: integer("admissions").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    state: allocationState("state").notNull().default("held"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Database-level backstop against double booking a seat or table.
    uniqueIndex("allocations_one_active_exclusive_uq")
      .on(t.inventoryItemId)
      .where(sql`${t.exclusive} AND ${t.state} IN ('held', 'confirmed')`),
    index("allocations_event_state_idx").on(t.eventId, t.state),
    index("allocations_order_idx").on(t.orderId),
    check("allocations_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

/* ------------------------------------------------------------------ */
/* Payments                                                           */
/* ------------------------------------------------------------------ */

export const paymentAttemptState = pgEnum("payment_attempt_state", [
  "created",
  "succeeded",
  "failed",
  "superseded",
]);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    /** Merchant account we expect the provider to report for this payment. */
    merchantId: text("merchant_id").notNull(),
    state: paymentAttemptState("state").notNull().default("created"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("payment_attempts_provider_session_uq").on(t.provider, t.providerSessionId)],
);

/** Every inbound provider notification, deduplicated by provider event id. */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    type: text("type").notNull(),
    providerSessionId: text("provider_session_id"),
    payload: jsonb("payload").notNull(),
    outcome: text("outcome"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("provider_events_provider_event_uq").on(t.provider, t.providerEventId)],
);

export const reconciliationState = pgEnum("reconciliation_state", ["open", "resolved"]);

export const reconciliationCases = pgTable("reconciliation_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  paymentAttemptId: uuid("payment_attempt_id").references(() => paymentAttempts.id),
  reason: text("reason").notNull(),
  state: reconciliationState("state").notNull().default("open"),
  notes: text("notes").notNull().default(""),
  resolvedBy: text("resolved_by").references(() => user.id),
  resolvedAt: ts("resolved_at"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Passes and check-in                                                */
/* ------------------------------------------------------------------ */

export const passState = pgEnum("pass_state", ["valid", "cancelled"]);

export const passes = pgTable(
  "passes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => allocations.id),
    /** 1..N within the allocation. Unique, so re-running confirmation cannot add passes. */
    sequence: integer("sequence").notNull(),
    label: text("label").notNull(),
    /** SHA-256 of the QR/share token. The raw token is never stored in plain text. */
    tokenHash: text("token_hash").notNull().unique(),
    tokenEncrypted: text("token_encrypted").notNull(),
    state: passState("state").notNull().default("valid"),
    admittedAt: ts("admitted_at"),
    admittedBy: text("admitted_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("passes_allocation_sequence_uq").on(t.allocationId, t.sequence),
    index("passes_order_idx").on(t.orderId),
    index("passes_event_idx").on(t.eventId),
  ],
);

export const checkInResult = pgEnum("check_in_result", [
  "admitted",
  "already_used",
  "cancelled",
  "wrong_event",
  "invalid",
]);
export const checkInMethod = pgEnum("check_in_method", ["scan", "manual"]);

/** Every scan attempt, successful or not. */
export const checkInRecords = pgTable(
  "check_in_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    passId: uuid("pass_id").references(() => passes.id),
    operatorUserId: text("operator_user_id")
      .notNull()
      .references(() => user.id),
    result: checkInResult("result").notNull(),
    method: checkInMethod("method").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("check_in_records_event_idx").on(t.eventId, t.createdAt),
    // Backstop: at most one successful admission per pass.
    uniqueIndex("check_in_records_one_admission_uq")
      .on(t.passId)
      .where(sql`${t.result} = 'admitted'`),
  ],
);

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

export const notificationChannel = pgEnum("notification_channel", ["email", "whatsapp"]);
export const notificationKind = pgEnum("notification_kind", ["initial_confirmation", "resend", "cancellation"]);
export const notificationState = pgEnum("notification_state", ["pending", "sending", "sent", "failed", "skipped"]);

export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    channel: notificationChannel("channel").notNull(),
    kind: notificationKind("kind").notNull(),
    state: notificationState("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    requestedBy: text("requested_by").references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Exactly one initial confirmation per order and channel.
    uniqueIndex("notification_jobs_initial_uq")
      .on(t.orderId, t.channel)
      .where(sql`${t.kind} = 'initial_confirmation'`),
    index("notification_jobs_due_idx").on(t.state, t.nextAttemptAt),
  ],
);

export const deliveryAttempts = pgTable("delivery_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => notificationJobs.id),
  success: boolean("success").notNull(),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  attemptedAt: ts("attempted_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Cancellations, refunds, audit                                      */
/* ------------------------------------------------------------------ */

export const cancellationState = pgEnum("cancellation_state", ["accepted", "rejected"]);
export const refundState = pgEnum("refund_state", ["not_required", "pending", "succeeded", "failed"]);

/** Cancellation decision. Kept separate from the refund's provider state. */
export const cancellations = pgTable(
  "cancellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    state: cancellationState("state").notNull(),
    reason: text("reason").notNull(),
    decidedBy: text("decided_by").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    // One accepted cancellation per order: reopening inventory happens exactly once.
    uniqueIndex("cancellations_one_accepted_uq")
      .on(t.orderId)
      .where(sql`${t.state} = 'accepted'`),
  ],
);

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  clubId: uuid("club_id")
    .notNull()
    .references(() => clubs.id),
  cancellationId: uuid("cancellation_id")
    .notNull()
    .references(() => cancellations.id),
  paymentAttemptId: uuid("payment_attempt_id").references(() => paymentAttempts.id),
  state: refundState("state").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  providerRefundId: text("provider_refund_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clubId: uuid("club_id").references(() => clubs.id),
    actorUserId: text("actor_user_id").references(() => user.id),
    actorType: text("actor_type").notNull(), // "staff" | "guest" | "system" | "provider"
    action: text("action").notNull(), // e.g. "order.confirmed"
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Never put contact details or tokens in here. */
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_club_created_idx").on(t.clubId, t.createdAt)],
);
