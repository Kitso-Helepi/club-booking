/**
 * Floor plan geometry (stored as JSON in layout_versions.geometry).
 *
 * Geometry is ONLY for drawing. Whether something can be booked, and its
 * availability, comes from inventory_items, which reference objects by `key`.
 * Keys must stay stable across versions so existing allocations keep pointing
 * at the same table or seat.
 */
import { z } from "zod";

export const objectTypes = ["table", "chair", "booth", "zone", "bar", "stage", "entrance", "label"] as const;
export type ObjectType = (typeof objectTypes)[number];

export const layoutObject = z.object({
  key: z.string().regex(/^[a-z0-9-]{1,40}$/, "Keys use a-z, 0-9 and dashes"),
  type: z.enum(objectTypes),
  label: z.string().max(40).default(""),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  shape: z.enum(["rect", "circle"]).default("rect"),
  /** Decorative objects are drawn but never sold. */
  bookable: z.boolean().default(false),
  /** Zone this object sits in (for tables/chairs/booths). */
  zoneKey: z.string().optional(),
  /** Zones only: what may be sold inside this zone for an event. */
  zoneMode: z.enum(["tables", "seats"]).optional(),
  /** Bookable objects only. */
  booking: z
    .object({
      mode: z.enum(["exclusive_table", "seat"]),
      ticketTypeKey: z.string(),
      /** Guests included (= passes issued) for an exclusive table. */
      capacity: z.number().int().positive(),
    })
    .optional(),
});
export type LayoutObject = z.infer<typeof layoutObject>;

export const layoutGeometry = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  gridSize: z.number().positive().default(20),
  objects: z.array(layoutObject),
});
export type LayoutGeometry = z.infer<typeof layoutGeometry>;
