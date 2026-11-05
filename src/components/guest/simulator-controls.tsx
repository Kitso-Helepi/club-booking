"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const outcomes = [
  { id: "success", label: "Payment succeeds", hint: "Normal successful payment." },
  { id: "failure", label: "Payment fails", hint: "Card declined. Items are released." },
  { id: "duplicate", label: "Success, notified twice", hint: "Same webhook delivered twice. Must not create extra passes." },
  { id: "late_success", label: "Success after hold expired", hint: "Confirms only if the items are still free; otherwise opens a reconciliation case." },
] as const;

export function SimulatorControls({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(outcome: string) {
    setBusy(outcome);
    setError(null);
    try {
      const res = await fetch(`/api/simulator/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Simulator error");
      // Like a real gateway redirect: the order page only SHOWS status.
      window.location.assign(data.orderPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulator error");
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 space-y-3">
      {outcomes.map((o, i) => (
        <div key={o.id}>
          <Button
            variant={i === 0 ? "default" : "outline"}
            size="lg"
            className="min-h-12 w-full justify-start text-base"
            disabled={!!busy}
            onClick={() => run(o.id)}
          >
            {busy === o.id && <Loader2 aria-hidden className="size-4 animate-spin" />}
            {o.label}
          </Button>
          <p className="mt-1 px-1 text-xs text-muted-foreground">{o.hint}</p>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
