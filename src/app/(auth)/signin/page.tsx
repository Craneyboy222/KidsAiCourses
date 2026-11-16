import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/layout";
import { Callout, cx } from "@/components/ui";
import { safeNextPath } from "@/lib/protected-paths";
import { tMany } from "@/server/copy";
import { AuthFinePrint } from "../_components/fine-print";
import { redirectIfSignedIn } from "../_lib/after-sign-in";
import { EmailSignInForm, LearnerSignInForm, MagicLinkForm } from "./sign-in-forms";

export const metadata: Metadata = { title: "Sign in" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

const NOTICES: Record<string, { tone: "info" | "success" | "warning"; title: string; body: string }> = {
  created: { tone: "success", title: "Your account is ready", body: "Sign in with the username and password you just chose." },
  joined: { tone: "success", title: "Password set", body: "Sign in with your username and your new password." },
  reset: { tone: "success", title: "Password changed", body: "Sign in with your new password. You've been signed out everywhere else." },
  link: { tone: "warning", title: "That link has run out", body: "Links work once and only for a short time. Sign in below, or ask for a new link." },
  signedout: { tone: "info", title: "You're signed out", body: "See you next time." },
};

const tabLink =
  "inline-flex min-h-11 flex-1 items-center justify-center rounded-control border-2 border-ink px-3 text-center font-bold text-ink no-underline hover:bg-tint " +
  "aria-[current=page]:bg-ink aria-[current=page]:text-paper";

export default async function SignInPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const next = safeNextPath(one(params.next), "");
  const ctx = await redirectIfSignedIn(next);

  const area = (next.split(/[/?#]/)[1] ?? "").toLowerCase();
  const asked = one(params.as);
  const who: "learner" | "parent" = asked === "parent" || asked === "learner" ? asked : ["parent", "studio", "approve"].includes(area) ? "parent" : "learner";
  const notice = NOTICES[one(params.notice)];
  const copy = await tMany(ctx, ["signin.learner.forgot_password"]);
  const href = (as: string) => `/signin?as=${as}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthShell
      title="Sign in"
      footer={
        <p>
          New here?{" "}
          <Link href="/signup/parent" className="link">
            Create a family account
          </Link>{" "}
          or{" "}
          <Link href="/signup/teen" className="link">
            sign up as a teenager
          </Link>
          .
        </p>
      }
      finePrint={<AuthFinePrint />}
    >
      {notice && (
        <Callout tone={notice.tone} title={notice.title}>
          <p>{notice.body}</p>
        </Callout>
      )}

      <nav aria-label="Who is signing in?">
        <ul className="flex gap-2">
          <li className="flex flex-1">
            <Link href={href("learner")} data-button="" aria-current={who === "learner" ? "page" : undefined} className={cx(tabLink)}>
              Learner
            </Link>
          </li>
          <li className="flex flex-1">
            <Link href={href("parent")} data-button="" aria-current={who === "parent" ? "page" : undefined} className={cx(tabLink)}>
              Parent or carer
            </Link>
          </li>
        </ul>
      </nav>

      {who === "learner" ? (
        <>
          <LearnerSignInForm next={next} />
          <div className="text-ink-muted flex flex-col gap-2 text-sm">
            <p>{copy["signin.learner.forgot_password"]}</p>
            <p>
              Got a code from your parent or carer?{" "}
              <Link href="/join" className="link">
                Use your code
              </Link>
              .
            </p>
            <p>
              18 or over with your own email address?{" "}
              <Link href="/reset" className="link">
                Reset your password by email
              </Link>
              .
            </p>
          </div>
        </>
      ) : (
        <>
          <EmailSignInForm next={next} />
          <p className="text-sm">
            <Link href="/reset" className="link">
              Forgot your password?
            </Link>
          </p>
          <section className="border-line flex flex-col gap-3 border-t-2 pt-5">
            <h2 className="text-xl font-bold">Or get a sign-in link by email</h2>
            <p className="text-ink-muted">For parents and carers. No password needed: we email you a link that works once, for 10 minutes.</p>
            <MagicLinkForm next={next} />
          </section>
          <p className="text-ink-muted text-sm">Members of our team sign in here too, with their email, password and two-step code.</p>
        </>
      )}
    </AuthShell>
  );
}
