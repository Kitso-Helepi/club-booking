/** Formatting helpers safe to use on client and server. */

/** Money is stored in minor units (e.g. cents). 12550 ZAR -> "R 125.50". */
export function formatMoney(minor: number, currency: string, locale = "en-ZA"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
}

/** Always show event times in the VENUE's time zone, not the viewer's. */
export function formatVenueDateTime(date: Date | string, timeZone: string, locale = "en-ZA"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(date));
}

export function formatVenueTime(date: Date | string, timeZone: string, locale = "en-ZA"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}
