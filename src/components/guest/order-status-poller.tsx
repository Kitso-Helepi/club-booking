"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Polls order status until the webhook has been processed, then re-renders the page. */
export function OrderStatusPoller({ token }: { token: string }) {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      try {
        const res = await fetch(`/api/orders/${token}/status`, { cache: "no-store" });
        setOffline(false);
        const data = await res.json();
        if (data.state && data.state !== "pending_payment") {
          clearInterval(t);
          router.refresh();
        }
      } catch {
        setOffline(true);
      }
      if (tries > 150) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [token, router]);
  return offline ? (
    <p role="alert" className="mt-2 text-sm text-destructive">
      Connection lost. Status may be out of date. Reconnect to see your passes.
    </p>
  ) : null;
}
