"use client";

/**
 * Read-only guest floor map, drawn as SVG.
 * Bookable objects are real buttons: focusable, labelled, keyboard operable.
 * (The staff EDITOR uses Konva; guests only need to tap.)
 */
import type { LayoutGeometry, LayoutObject } from "@/domain/layout";
import type { ItemAvailability } from "@/server/booking/availability";

const fillFor: Record<string, string> = {
  available: "var(--state-available)",
  held: "var(--state-held)",
  sold: "var(--state-sold)",
  unavailable: "var(--state-unavailable)",
  selected: "var(--state-selected)",
};
const stateText: Record<string, string> = { held: "HELD", sold: "SOLD", unavailable: "N/A", selected: "✓" };

type Props = {
  geometry: LayoutGeometry;
  items: ItemAvailability[];
  selected: Record<string, number>;
  onToggle: (id: string) => void;
};

export function FloorMap({ geometry, items, selected, onToggle }: Props) {
  const byKey = new Map(items.filter((i) => i.objectKey).map((i) => [i.objectKey!, i]));
  const decor = geometry.objects.filter((o) => !o.bookable);
  const bookable = geometry.objects.filter((o) => o.bookable);

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        className="h-auto w-full touch-manipulation select-none"
        role="group"
        aria-label="Floor map. Use the list view for a text-only alternative."
      >
        {decor.map((o) => (
          <Decor key={o.key} o={o} />
        ))}
        {bookable.map((o) => {
          const item = byKey.get(o.key);
          if (!item) return null;
          const isSelected = (selected[item.id] ?? 0) > 0;
          const state = isSelected ? "selected" : item.displayState;
          const disabled = item.displayState !== "available";
          const cx = o.x + o.width / 2;
          const cy = o.y + o.height / 2;
          const label = `${item.label}, ${item.ticketTypeName}, ${disabled ? item.displayState : isSelected ? "selected" : "available"}`;
          return (
            <g
              key={o.key}
              role="button"
              tabIndex={disabled ? -1 : 0}
              aria-label={label}
              aria-pressed={isSelected}
              aria-disabled={disabled}
              onClick={() => onToggle(item.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggle(item.id);
                }
              }}
              className={disabled ? "cursor-not-allowed" : "cursor-pointer focus:outline-none [&:focus-visible>.ring]:opacity-100"}
              transform={`rotate(${o.rotation} ${cx} ${cy})`}
            >
              {/* Larger invisible hit area for fingers */}
              <circle cx={cx} cy={cy} r={Math.max(o.width, o.height) / 2 + 8} fill="transparent" />
              <circle className="ring opacity-0" cx={cx} cy={cy} r={Math.max(o.width, o.height) / 2 + 5} fill="none" stroke="white" strokeWidth={3} />
              {o.shape === "circle" ? (
                <ellipse cx={cx} cy={cy} rx={o.width / 2} ry={o.height / 2} fill={fillFor[state]} stroke={isSelected ? "white" : "transparent"} strokeWidth={3} />
              ) : (
                <rect x={o.x} y={o.y} width={o.width} height={o.height} rx={6} fill={fillFor[state]} stroke={isSelected ? "white" : "transparent"} strokeWidth={3} />
              )}
              <text x={cx} y={cy + (stateText[state] ? -2 : 4)} textAnchor="middle" fontSize={o.width > 50 ? 15 : 11} fontWeight={700} fill="#14121c">
                {item.label}
              </text>
              {stateText[state] && (
                <text x={cx} y={cy + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill="#14121c">
                  {stateText[state]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Decor({ o }: { o: LayoutObject }) {
  const cx = o.x + o.width / 2;
  const cy = o.y + o.height / 2;
  if (o.type === "zone") {
    return (
      <g aria-hidden>
        <rect x={o.x} y={o.y} width={o.width} height={o.height} rx={12} fill="white" fillOpacity={0.03} stroke="white" strokeOpacity={0.25} strokeDasharray="6 6" />
        <text x={o.x + 10} y={o.y + 20} fontSize={13} fill="white" fillOpacity={0.7}>
          {o.label}
        </text>
      </g>
    );
  }
  const fill = o.type === "stage" ? "oklch(0.45 0.12 300)" : o.type === "bar" ? "oklch(0.42 0.08 60)" : o.type === "entrance" ? "oklch(0.5 0.1 230)" : "transparent";
  return (
    <g aria-hidden transform={`rotate(${o.rotation} ${cx} ${cy})`}>
      <rect x={o.x} y={o.y} width={o.width} height={o.height} rx={8} fill={fill} stroke="white" strokeOpacity={o.type === "label" ? 0.15 : 0} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={14} fill="white" fillOpacity={0.85}>
        {o.label}
      </text>
    </g>
  );
}
