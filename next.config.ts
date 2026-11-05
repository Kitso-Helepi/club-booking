import type { NextConfig } from "next";

// Decision: Cache Components is OFF. Almost every page in a booking app is
// per-request (availability, holds, orders), and the classic dynamic model is
// easier for a student team to reason about. Revisit for marketing pages later.
const nextConfig: NextConfig = {
  cacheComponents: false,
  // The dev badge covers the bottom basket bar on phones.
  devIndicators: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Server-only packages that should not be bundled.
  serverExternalPackages: ["pg", "nodemailer"],
};

export default nextConfig;
