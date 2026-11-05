"use client";

import { useState } from "react";
import { Copy, ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Guest-initiated sharing of ONE pass. Opens WhatsApp (or the system share
 * sheet) with just this pass's link. We never message anyone automatically here.
 */
export function SharePass({ url, label, eventTitle }: { url: string; label: string; eventTitle: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Your pass for ${eventTitle} (${label}): ${url}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;

  async function nativeShare() {
    if (navigator.share) {
      await navigator.share({ title: eventTitle, text: `Your pass (${label})`, url }).catch(() => {});
    } else {
      window.open(wa, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      <Button asChild size="sm" className="min-h-11">
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`Share ${label} on WhatsApp`}>
          WhatsApp
        </a>
      </Button>
      <Button size="sm" variant="outline" className="min-h-11" onClick={nativeShare} aria-label={`Share ${label}`}>
        <Share2 aria-hidden className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="min-h-11"
        aria-label={copied ? "Link copied" : `Copy link for ${label}`}
        onClick={async () => {
          await navigator.clipboard?.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : <Copy aria-hidden className="size-4" />}
      </Button>
      <a href={url} target="_blank" rel="noopener" className="col-span-3 inline-flex items-center justify-center gap-1 text-xs text-muted-foreground underline underline-offset-4">
        Open this pass <ExternalLink aria-hidden className="size-3" />
      </a>
    </div>
  );
}
