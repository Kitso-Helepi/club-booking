"use client";

/**
 * Door check-in screen.
 *
 * Design rules:
 *  - One-handed: all controls in the bottom half; huge tap targets.
 *  - Poor lighting: full-screen colour + giant words + icon. Never colour alone.
 *  - Honest: if the server did not answer, show UNVERIFIED. No offline admission.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { IScannerControls } from "@zxing/browser";
import { Ban, Camera, CircleAlert, CircleCheck, Keyboard, Search, WifiOff, X } from "lucide-react";
import type { CheckInResponse } from "@/server/checkin";

type Shown =
  | { kind: "result"; data: CheckInResponse }
  | { kind: "unverified"; reason: string }
  | null;

type LookupResult = {
  orderId: string;
  bookingReference: string;
  state: string;
  buyerName: string;
  passes: { id: string; label: string; state: string; admittedAt: string | null }[];
};

const resultUi: Record<CheckInResponse["result"], { title: string; bg: string; Icon: typeof CircleCheck }> = {
  admitted: { title: "ADMIT", bg: "bg-door-admitted", Icon: CircleCheck },
  already_used: { title: "ALREADY USED", bg: "bg-door-warning", Icon: CircleAlert },
  cancelled: { title: "CANCELLED", bg: "bg-door-reject", Icon: Ban },
  wrong_event: { title: "WRONG EVENT", bg: "bg-door-reject", Icon: Ban },
  invalid: { title: "INVALID", bg: "bg-door-reject", Icon: Ban },
};

function timeOf(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const noopSubscribe = () => () => {};

type Stats = { issued: number; admitted: number };

export function DoorScreen({ eventId, eventTitle, initialStats }: { eventId: string; eventTitle: string; initialStats: Stats }) {
  const [mode, setMode] = useState<"scan" | "code" | "lookup">("scan");
  const [shown, setShown] = useState<Shown>(null);
  const [busy, setBusy] = useState(false);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const secure = useSyncExternalStore(noopSubscribe, () => window.isSecureContext, () => true);
  const [stats, setStats] = useState<Stats>(initialStats);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScan = useRef<{ value: string; at: number }>({ value: "", at: 0 });
  const pausedRef = useRef(false);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/staff/events/${eventId}/lookup?q=`, { cache: "no-store" });
      if (res.ok) setStats((await res.json()).stats);
    } catch {
      /* stats are informational only */
    }
  }, [eventId]);

  const submit = useCallback(
    async (body: { token: string } | { passId: string }) => {
      setBusy(true);
      pausedRef.current = true;
      try {
        const res = await fetch(`/api/staff/events/${eventId}/check-in`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
        if (res.status === 401) {
          setShown({ kind: "unverified", reason: "Signed out. Sign in again before admitting anyone." });
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setShown({ kind: "unverified", reason: data?.error?.message ?? `Server error (${res.status})` });
          return;
        }
        const data: CheckInResponse = await res.json();
        setShown({ kind: "result", data });
        navigator.vibrate?.(data.result === "admitted" ? 80 : [200, 80, 200]);
        refreshStats();
      } catch {
        setShown({ kind: "unverified", reason: "No connection. This pass has NOT been checked." });
        navigator.vibrate?.([300, 100, 300]);
      } finally {
        setBusy(false);
      }
    },
    [eventId, refreshStats],
  );

  // Camera scanning with ZXing.
  useEffect(() => {
    if (mode !== "scan" || !secure) return;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          videoRef.current!,
          (result) => {
            if (!result || pausedRef.current) return;
            const value = result.getText();
            const now = Date.now();
            if (value === lastScan.current.value && now - lastScan.current.at < 4000) return;
            lastScan.current = { value, at: now };
            submit({ token: value });
          },
        );
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
        setCameraError(null);
      } catch (e) {
        setCameraError(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was denied. Allow it in browser settings, or use 'Enter code'." : "Camera unavailable. Use 'Enter code'.");
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [mode, secure, submit]);

  const dismiss = () => {
    setShown(null);
    pausedRef.current = false;
  };

  // Auto-continue after a clean admit so the queue keeps moving.
  useEffect(() => {
    if (shown?.kind === "result" && shown.data.result === "admitted") {
      const t = setTimeout(dismiss, 2500);
      return () => clearTimeout(t);
    }
  }, [shown]);

  return (
    <div className="flex h-dvh flex-col bg-black text-white">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <Link href="/staff" className="text-xs text-white/60 underline underline-offset-4">
            Events
          </Link>
          <p className="truncate font-semibold">{eventTitle}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums" aria-label="Admitted so far">
            {stats.admitted}/{stats.issued}
          </p>
          <p className={`text-xs ${online ? "text-white/60" : "font-bold text-door-warning"}`}>{online ? "admitted · online" : "OFFLINE"}</p>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {mode === "scan" && (
          <>
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera viewfinder" />
            <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="size-64 rounded-3xl border-4 border-white/70" />
            </div>
            {!secure && (
              <p className="absolute inset-x-4 top-4 rounded-lg bg-black/80 p-4 text-center">
                The camera needs HTTPS. Use &quot;Enter code&quot; or open this page over HTTPS.
              </p>
            )}
            {secure && cameraError && <p className="absolute inset-x-4 top-4 rounded-lg bg-black/80 p-4 text-center">{cameraError}</p>}
          </>
        )}
        {mode === "code" && <CodeEntry onSubmit={(token) => submit({ token })} busy={busy} />}
        {mode === "lookup" && <Lookup eventId={eventId} onAdmit={(passId) => submit({ passId })} busy={busy} />}

        {shown && <ResultOverlay shown={shown} onDismiss={dismiss} />}
      </div>

      <nav aria-label="Check-in method" className="grid grid-cols-3 gap-2 bg-neutral-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {(
          [
            ["scan", "Scan", Camera],
            ["code", "Enter code", Keyboard],
            ["lookup", "Look up", Search],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              dismiss();
            }}
            className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl bg-white/10 text-sm font-semibold aria-pressed:bg-white aria-pressed:text-black"
          >
            <Icon aria-hidden className="size-6" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function ResultOverlay({ shown, onDismiss }: { shown: NonNullable<Shown>; onDismiss: () => void }) {
  if (shown.kind === "unverified") {
    return (
      <button role="alert" onClick={onDismiss} className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-door-unverified p-6 text-center">
        <WifiOff aria-hidden className="size-24" />
        <p className="text-5xl font-black">UNVERIFIED</p>
        <p className="text-xl font-semibold">Do not admit on this scan.</p>
        <p className="text-lg">{shown.reason}</p>
        <p className="mt-6 rounded-xl bg-black/30 px-6 py-4 text-lg font-bold">Tap to try again</p>
      </button>
    );
  }
  const { data } = shown;
  const ui = resultUi[data.result];
  return (
    <button role="alert" onClick={onDismiss} className={`absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center ${ui.bg}`}>
      <ui.Icon aria-hidden className="size-28" strokeWidth={2.5} />
      <p className="text-6xl font-black leading-none">{ui.title}</p>
      {data.pass && <p className="text-2xl font-bold">{data.pass.label}</p>}
      {data.result === "already_used" && data.pass?.admittedAt && (
        <p className="text-2xl font-semibold">Checked in at {timeOf(data.pass.admittedAt)}</p>
      )}
      {data.result === "wrong_event" && <p className="text-xl">This pass is for a different event.</p>}
      {data.result === "invalid" && <p className="text-xl">Not a pass for this club. Ask for the booking reference.</p>}
      {data.group && (
        <p className="mt-2 rounded-xl bg-black/30 px-5 py-3 text-2xl font-bold">
          {data.group.label}: {data.group.admitted} of {data.group.total} in
        </p>
      )}
      {data.pass && <p className="font-mono text-lg opacity-80">{data.pass.bookingReference}</p>}
      <p className="mt-4 rounded-xl bg-black/30 px-6 py-4 text-lg font-bold">Tap for next guest</p>
    </button>
  );
}

function CodeEntry({ onSubmit, busy }: { onSubmit: (token: string) => void; busy: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex h-full flex-col justify-end gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
        setValue("");
      }}
    >
      <label htmlFor="code" className="text-lg font-semibold">
        Pass code or pass link
      </label>
      <input
        id="code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="h-14 rounded-xl border border-white/30 bg-white/10 px-4 font-mono text-lg"
        placeholder="Paste or type the code"
      />
      <button disabled={busy} className="min-h-16 rounded-xl bg-white text-xl font-bold text-black disabled:opacity-50">
        Check pass
      </button>
    </form>
  );
}

function Lookup({ eventId, onAdmit, busy }: { eventId: string; onAdmit: (passId: string) => void; busy: boolean }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch(`/api/staff/events/${eventId}/lookup?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Lookup failed");
      setResults(data.results);
    } catch (err) {
      setResults(null);
      setError(err instanceof Error && err.message !== "Failed to fetch" ? err.message : "No connection. Lookup unavailable.");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {error && <p className="rounded-lg bg-door-reject p-3 font-semibold">{error}</p>}
        {results?.length === 0 && <p className="text-white/70">No booking found for that reference.</p>}
        {results?.map((r) => (
          <div key={r.orderId} className="mb-4 rounded-xl bg-white/10 p-4">
            <p className="font-mono text-lg font-bold">{r.bookingReference}</p>
            <p className="text-sm text-white/70">
              {r.buyerName} · {r.state}
            </p>
            <ul className="mt-3 space-y-2">
              {r.passes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span>
                    {p.label}
                    <span className="block text-xs text-white/60">
                      {p.state === "cancelled" ? "Cancelled" : p.admittedAt ? `In at ${timeOf(p.admittedAt)}` : "Not in yet"}
                    </span>
                  </span>
                  {p.state === "valid" && !p.admittedAt && (
                    <button disabled={busy} onClick={() => onAdmit(p.id)} className="min-h-12 rounded-lg bg-white px-4 font-bold text-black">
                      Admit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <form onSubmit={search} className="flex gap-2 p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Booking ref e.g. CB-7KQ4…"
          autoCapitalize="characters"
          className="h-14 flex-1 rounded-xl border border-white/30 bg-white/10 px-4 font-mono text-lg"
          aria-label="Booking reference"
        />
        <button className="min-h-14 rounded-xl bg-white px-5 font-bold text-black" aria-label="Search">
          <Search aria-hidden />
        </button>
        {q && (
          <button type="button" onClick={() => { setQ(""); setResults(null); }} className="min-h-14 rounded-xl bg-white/10 px-3" aria-label="Clear">
            <X aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
