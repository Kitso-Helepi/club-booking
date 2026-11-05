/**
 * Email transport (Nodemailer over SMTP). Locally SMTP points at Mailpit,
 * which captures every message at http://localhost:8025 and delivers nothing.
 */
import nodemailer from "nodemailer";

export type OutgoingEmail = { to: string; subject: string; text: string; html: string };
export type SendResult = { providerMessageId: string };
export interface EmailSender {
  send(msg: OutgoingEmail): Promise<SendResult>;
}

/**
 * In "allowlist" mode (real SMTP during testing) only approved recipients
 * receive mail, so test bookings can never reach real guests by accident.
 */
export function isRecipientAllowed(to: string): boolean {
  if ((process.env.EMAIL_DELIVERY_MODE ?? "capture") === "capture") return true;
  const allowed = (process.env.EMAIL_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const addr = to.trim().toLowerCase();
  return allowed.some((a) => (a.startsWith("@") ? addr.endsWith(a) : addr === a));
}

export function smtpSender(): EmailSender {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  return {
    async send(msg) {
      const info = await transport.sendMail({ from: process.env.EMAIL_FROM ?? "Club Booking <no-reply@club-booking.test>", ...msg });
      return { providerMessageId: info.messageId };
    },
  };
}
