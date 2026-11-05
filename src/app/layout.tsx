import type { Metadata, Viewport } from "next";
import "./globals.css";

const appName = process.env.APP_NAME ?? "Club Booking";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Book club events, tables and seats.",
  robots: { index: false }, // staging pilot: keep out of search engines
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#14121c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">{children}</body>
    </html>
  );
}
