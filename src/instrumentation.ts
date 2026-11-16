/**
 * Runs once when a Next.js server instance starts, before it handles any request.
 * The only job here is to connect the kernel hooks (see `src/server/kernel.ts`).
 */
export async function register(): Promise<void> {
  // The hooks use Node APIs and the database, so they are not loaded in any other runtime.
  // NEXT_RUNTIME is set by Next.js itself to say which runtime this is; it is not configuration,
  // which is why it is read here and not through `src/env.ts`.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installKernelHooks } = await import("@/server/kernel");
    installKernelHooks();
  }
}
