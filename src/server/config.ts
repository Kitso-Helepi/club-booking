import { z } from "zod";

/**
 * All server configuration is read and validated here, once.
 * Import `config()` instead of reading process.env elsewhere.
 */
const schema = z
  .object({
    APP_NAME: z.string().default("Club Booking"),
    APP_BASE_URL: z.string().url().default("http://localhost:3000"),
    DATABASE_URL: z.string().min(1),
    TOKEN_ENCRYPTION_KEY: z.string().min(1),
    HOLD_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    PAYMENTS_MODE: z.enum(["test", "live"]).default("test"),
    PAYMENT_PROVIDER: z.enum(["simulator"]).default("simulator"),
    PAYMENT_SIMULATOR_SECRET: z.string().default(""),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_SECURE: z
      .string()
      .default("false")
      .transform((v) => v === "true"),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    EMAIL_FROM: z.string().default("Club Booking <no-reply@club-booking.test>"),
    EMAIL_DELIVERY_MODE: z.enum(["capture", "allowlist"]).default("capture"),
    EMAIL_ALLOWED_RECIPIENTS: z.string().default(""),
    WHATSAPP_AUTOMATION_ENABLED: z
      .string()
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((c, ctx) => {
    // Safety rail: the simulator can never run with live payments.
    if (c.PAYMENTS_MODE === "live" && c.PAYMENT_PROVIDER === "simulator") {
      ctx.addIssue({
        code: "custom",
        message: "PAYMENT_PROVIDER=simulator is not allowed when PAYMENTS_MODE=live",
      });
    }
    if (c.PAYMENT_PROVIDER === "simulator" && c.PAYMENT_SIMULATOR_SECRET.length < 16) {
      ctx.addIssue({ code: "custom", message: "PAYMENT_SIMULATOR_SECRET must be at least 16 characters" });
    }
  });

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Do not print values: they may be secrets.
      const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "config"}: ${i.message}`);
      throw new Error(`Invalid server configuration:\n  ${problems.join("\n  ")}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Tests change env between files; this clears the cache. */
export function resetConfigForTests() {
  cached = undefined;
}
