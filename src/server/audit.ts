import type { DbOrTx } from "@/db/client";
import { auditEvents } from "@/db/schema";

export type AuditInput = {
  clubId: string | null;
  actorUserId?: string | null;
  actorType: "staff" | "guest" | "system" | "provider";
  action: string;
  entityType: string;
  entityId: string;
  /** Never include contact details, credentials or tokens. */
  data?: Record<string, unknown>;
};

/** Write an audit row. Call it inside the same transaction as the change it describes. */
export async function audit(tx: DbOrTx, e: AuditInput) {
  await tx.insert(auditEvents).values({
    clubId: e.clubId,
    actorUserId: e.actorUserId ?? null,
    actorType: e.actorType,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    data: e.data ?? {},
  });
}
