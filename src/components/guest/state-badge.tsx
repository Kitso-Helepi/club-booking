/** Inventory state shown with BOTH colour and text (never colour alone). */
const styles = {
  available: { label: "Available", dot: "bg-state-available" },
  selected: { label: "Selected", dot: "bg-state-selected" },
  held: { label: "On hold", dot: "bg-state-held" },
  sold: { label: "Sold", dot: "bg-state-sold" },
  unavailable: { label: "Unavailable", dot: "bg-state-unavailable" },
} as const;

export type BadgeState = keyof typeof styles;

export function StateBadge({ state }: { state: BadgeState }) {
  const s = styles[state];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium">
      <span aria-hidden className={`size-2.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
