import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";

// Better Auth's endpoints (sign-in, sign-out, session). Rate limited by Better Auth.
export const { GET, POST } = toNextJsHandler((req: Request) => auth().handler(req));
