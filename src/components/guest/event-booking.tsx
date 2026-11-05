"use client";

/**
 * Guest selection: floor map + accessible list, and the basket bar.
 * The browser only REQUESTS items; the server re-checks availability and prices.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Map as MapIcon, List, Minus, Plus, Users } from "lucide-react";
import type { ItemAvailability } from "@/server/booking/availability";
import type { LayoutGeometry } from "@/domain/layout";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FloorMap } from "./floor-map";
import { StateBadge } from "./state-badge";

type Props = {
  eventId: string;
  currency: string;
  items: ItemAvailability[];
  geometry: LayoutGeometry | null;
  admissionsRemaining: number;
};

export function EventBooking({ eventId, currency, items, geometry, admissionsRemaining }: Props) {
  const router = useRouter();
  const [view, setView] = useState<"map" | "list">(geometry ? "map" : "list");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const lines = Object.entries(selected).filter(([, q]) => q > 0);
  const totalMinor = lines.reduce((s, [id, q]) => s + (byId.get(id)?.priceMinor ?? 0) * q, 0);
  const admissions = lines.reduce((s, [id, q]) => s + (byId.get(id)?.admissionsPerUnit ?? 0) * q, 0);

  const toggle = (id: string) => {
    const item = byId.get(id);
    if (!item || item.displayState !== "available") return;
    setError(null);
    setSelected((s) => ({ ...s, [id]: s[id] ? 0 : 1 }));
    setFocusId(id);
  };
  const setQty = (id: string, q: number) => {
    const item = byId.get(id);
    if (!item) return;
    setSelected((s) => ({ ...s, [id]: Math.max(0, Math.min(q, item.availableUnits, 10)) }));
  };

  async function reserve() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, items: lines.map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity })) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not reserve. Please try again.");
        if (res.status === 409) router.refresh(); // show fresh availability
        return;
      }
      router.push(`/checkout/${data.holdId}`);
    } catch {
      setError("You appear to be offline. Nothing was reserved.");
    } finally {
      setBusy(false);
    }
  }

  const groups = useMemo(() => {
    const g = new Map<string, ItemAvailability[]>();
    for (const i of items) g.set(i.ticketTypeId, [...(g.get(i.ticketTypeId) ?? []), i]);
    return [...g.values()].sort((a, b) => order(a[0].kind) - order(b[0].kind));
  }, [items]);

  const focused = focusId ? byId.get(focusId) : undefined;

  return (
    <section aria-labelledby="choose" className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <h2 id="choose" className="text-xl font-semibold">
          Choose your spot
        </h2>
        <p className="text-sm text-muted-foreground">
          {admissionsRemaining > 0 ? `${admissionsRemaining} admissions left` : "Sold out"}
        </p>
      </div>

      {geometry && (
        <div role="tablist" aria-label="Selection view" className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-medium aria-selected:bg-background aria-selected:shadow"
            >
              {v === "map" ? <MapIcon aria-hidden className="size-4" /> : <List aria-hidden className="size-4" />}
              {v === "map" ? "Floor map" : "List"}
            </button>
          ))}
        </div>
      )}

      <Legend />

      {view === "map" && geometry ? (
        <div className="mt-3">
          <FloorMap geometry={geometry} items={items} selected={selected} onToggle={toggle} />
          {focused && (
            <div className="mt-3 rounded-lg border bg-card p-4" aria-live="polite">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">
                  {focused.label} · {focused.ticketTypeName}
                </p>
                <StateBadge state={selected[focused.id] ? "selected" : focused.displayState} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{focused.ticketTypeDescription}</p>
              <p className="mt-2 text-sm">
                {formatMoney(focused.priceMinor, currency)} · includes {focused.admissionsPerUnit} admission
                {focused.admissionsPerUnit > 1 ? "s" : ""}
              </p>
            </div>
          )}
          {groups
            .filter((g) => g[0].kind === "general_admission")
            .map((g) => (
              <ItemGroup key={g[0].ticketTypeId} items={g} currency={currency} selected={selected} onToggle={toggle} onQty={setQty} />
            ))}
        </div>
      ) : (
        <div className="mt-3 space-y-6">
          {groups.map((g) => (
            <ItemGroup key={g[0].ticketTypeId} items={g} currency={currency} selected={selected} onToggle={toggle} onQty={setQty} />
          ))}
        </div>
      )}

      {/* Basket bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3">
          {error && (
            <p role="alert" className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1" aria-live="polite">
              {lines.length ? (
                <>
                  <p className="text-lg font-bold">{formatMoney(totalMinor, currency)}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users aria-hidden className="size-3" /> {admissions} admission{admissions === 1 ? "" : "s"} ·
                    total incl. all fees
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a table, seat or ticket</p>
              )}
            </div>
            <Button size="lg" className="min-h-12 px-6 text-base" disabled={!lines.length || busy} onClick={reserve}>
              {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Reserve
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function order(kind: string) {
  return kind === "table" ? 0 : kind === "seat" ? 1 : 2;
}

function Legend() {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {(["available", "selected", "held", "sold", "unavailable"] as const).map((s) => (
        <li key={s}>
          <StateBadge state={s} />
        </li>
      ))}
    </ul>
  );
}

function ItemGroup({
  items,
  currency,
  selected,
  onToggle,
  onQty,
}: {
  items: ItemAvailability[];
  currency: string;
  selected: Record<string, number>;
  onToggle: (id: string) => void;
  onQty: (id: string, q: number) => void;
}) {
  const head = items[0];
  return (
    <div className="mt-6">
      <h3 className="text-base font-semibold">{head.ticketTypeName}</h3>
      <p className="text-sm text-muted-foreground">
        {head.ticketTypeDescription} {formatMoney(head.priceMinor, currency)}
        {head.kind === "table" ? ` per table · ${head.admissionsPerUnit} passes included` : " each"}
      </p>
      <ul className="mt-2 divide-y rounded-lg border bg-card">
        {items.map((i) => {
          const q = selected[i.id] ?? 0;
          const isGa = i.kind === "general_admission";
          return (
            <li key={i.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{i.label}</p>
                <p className="text-xs text-muted-foreground">
                  {isGa ? `${i.availableUnits} left` : `${i.admissionsPerUnit} admission${i.admissionsPerUnit > 1 ? "s" : ""}`}
                </p>
              </div>
              <StateBadge state={q ? "selected" : i.displayState} />
              {isGa ? (
                <div className="flex items-center gap-1" role="group" aria-label={`${i.label} quantity`}>
                  <Button variant="outline" size="icon" className="size-11" aria-label="Fewer" disabled={q === 0} onClick={() => onQty(i.id, q - 1)}>
                    <Minus aria-hidden />
                  </Button>
                  <span className="w-6 text-center tabular-nums" aria-live="polite">
                    {q}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11"
                    aria-label="More"
                    disabled={i.displayState !== "available" || q >= Math.min(i.availableUnits, 10)}
                    onClick={() => onQty(i.id, q + 1)}
                  >
                    <Plus aria-hidden />
                  </Button>
                </div>
              ) : (
                <Button
                  variant={q ? "default" : "outline"}
                  className="min-h-11 min-w-20"
                  disabled={i.displayState !== "available"}
                  aria-pressed={q > 0}
                  aria-label={`${q ? "Remove" : "Add"} ${i.label}`}
                  onClick={() => onToggle(i.id)}
                >
                  {q ? "Added" : "Add"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
