import type { ReactNode } from "react";
import { BrandMark } from "./brand-mark";

export type AuthShellProps = {
  /** The page's `<h1>`: "Sign in", "Create your account". */
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Under the card: the other route, for example "New here? Create an account". */
  footer?: ReactNode;
  /** Small print at the very bottom, for example links to Help and Privacy. */
  finePrint?: ReactNode;
};

/** Sign-in, sign-up, approval and reset pages: one calm, centred column with nothing to distract. */
export function AuthShell({ title, description, children, footer, finePrint }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:py-12">
      <header className="mb-8">
        <BrandMark href="/" />
      </header>
      <main id="main" tabIndex={-1} className="flex w-full max-w-md flex-col gap-6 outline-none">
        <div className="rounded-card border-ink bg-surface flex flex-col gap-6 border-2 p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold">{title}</h1>
            {description && <p className="text-ink-muted">{description}</p>}
          </div>
          {children}
        </div>
        {footer && <div className="text-center">{footer}</div>}
      </main>
      {finePrint && <footer className="text-ink-muted mt-10 text-center text-sm">{finePrint}</footer>}
    </div>
  );
}
