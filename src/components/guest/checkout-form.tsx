"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = { holdId: string; expiresAt: string; eventPath: string; isFree: boolean };

function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

export function CheckoutForm({ holdId, expiresAt, eventPath, isFree }: Props) {
  const router = useRouter();
  const secondsLeft = useCountdown(expiresAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const expired = secondsLeft === 0;
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/holds/${holdId}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyerName: fd.get("buyerName"),
          buyerEmail: fd.get("buyerEmail"),
          buyerPhone: fd.get("buyerPhone") ?? "",
          whatsappOptIn: fd.get("whatsappOptIn") === "on",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === "validation" && Array.isArray(data.error.details)) {
          const fe: Record<string, string> = {};
          for (const d of data.error.details) fe[String(d.path?.[0])] = d.message;
          setFieldErrors(fe);
        }
        setError(data?.error?.message ?? "Checkout failed. Please try again.");
        if (res.status === 410) router.refresh();
        return;
      }
      window.location.assign(data.redirectUrl);
    } catch {
      setError("Connection lost. You have not been charged. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function giveBack() {
    await fetch(`/api/holds/${holdId}`, { method: "DELETE" }).catch(() => {});
    router.push(eventPath);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div
        role="timer"
        aria-live={secondsLeft < 60 ? "assertive" : "off"}
        className={`flex items-center gap-2 rounded-lg p-3 text-sm font-medium ${secondsLeft < 120 ? "bg-state-held/15 text-state-held" : "bg-muted"}`}
      >
        <Clock aria-hidden className="size-4" />
        {expired ? "Reservation time is up" : `Held for you for ${mm}:${ss}`}
      </div>

      <Field label="Full name" name="buyerName" autoComplete="name" required error={fieldErrors.buyerName} />
      <Field label="Email" name="buyerEmail" type="email" autoComplete="email" required error={fieldErrors.buyerEmail} hint="Your passes and private booking link are sent here." />
      <Field label="Mobile number (optional)" name="buyerPhone" type="tel" autoComplete="tel" error={fieldErrors.buyerPhone} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="whatsappOptIn" className="mt-1 size-5 accent-[var(--primary)]" />
        <span>
          Send my confirmation on WhatsApp too.{" "}
          <span className="text-muted-foreground">Optional. Automated WhatsApp is currently switched off in this pilot; you can always share passes yourself.</span>
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="min-h-12 w-full text-base" disabled={busy || expired}>
        {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {isFree ? "Confirm free reservation" : "Continue to payment"}
      </Button>
      <button type="button" onClick={giveBack} className="w-full py-2 text-sm text-muted-foreground underline underline-offset-4">
        Cancel and release these items
      </button>
    </form>
  );
}

function Field(props: { label: string; name: string; type?: string; autoComplete?: string; required?: boolean; error?: string; hint?: string }) {
  const id = `f-${props.name}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        name={props.name}
        type={props.type ?? "text"}
        autoComplete={props.autoComplete}
        required={props.required}
        aria-invalid={!!props.error}
        aria-describedby={props.error ? `${id}-err` : props.hint ? `${id}-hint` : undefined}
        className="h-12 text-base"
      />
      {props.hint && !props.error && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      )}
      {props.error && (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {props.error}
        </p>
      )}
    </div>
  );
}
