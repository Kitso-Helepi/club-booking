/**
 * Helpers for route handlers: consistent JSON errors, no sensitive logging.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { isAppError } from "./errors";

export type ApiError = { error: { code: string; message: string; details?: unknown } };

export function jsonError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json<ApiError>({ error: { code, message, details } }, { status });
}

export async function handle<T>(fn: () => Promise<T>, init?: ResponseInit) {
  try {
    const data = await fn();
    return NextResponse.json(data, init);
  } catch (e) {
    if (isAppError(e)) return jsonError(e.status, e.code, e.message, e.details);
    if (e instanceof ZodError) {
      return jsonError(400, "validation", "Please check the highlighted fields", e.issues.map((i) => ({ path: i.path, message: i.message })));
    }
    // Log only the error type and message, never request bodies (they contain contact details).
    console.error("Unhandled API error:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
    return jsonError(500, "internal", "Something went wrong. Please try again.");
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
