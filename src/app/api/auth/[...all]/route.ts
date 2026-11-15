import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/auth";

/**
 * Mounts Better Auth at `/api/auth/*`: sign-in, sign-out, magic links, password reset and two-factor.
 * Account creation is not here: it goes through our own services (see `src/server/auth/accounts.ts`).
 * The instance is created on the first request, so `next build` needs no environment.
 */
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
