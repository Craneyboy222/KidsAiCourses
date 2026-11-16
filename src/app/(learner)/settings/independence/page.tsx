import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumbs, Callout, PageHeader } from "@/components/ui";
import { PARENT_VIEW_HIDDEN_KEYS, PARENT_VIEW_SEES_KEYS } from "@/content/copy/en-GB";
import { getCtx } from "@/server/context";
import { tMany } from "@/server/copy";
import { listConsentDefinitions, consentDefaultForBand } from "@/server/services/consent";
import { getIndependenceState } from "@/server/services/independence";
import { resolveAfterSignIn } from "@/server/services/sign-in";
import { ConfirmIndependenceForm, RemoveParentLinkForm, RequestIndependenceForm } from "./independence-forms";

export const metadata: Metadata = { title: "Run your own account", robots: { index: false, follow: false } };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/**
 * Account independence at 18 (spec 2 and 3.1). Offered, never forced: nothing changes until the
 * learner has confirmed their own email address and said yes on this page.
 *
 * No `<main>` here: the learner layout (owned by the learning slice) provides the page frame.
 */
export default async function IndependencePage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const token = one(params.token).slice(0, 200);
  const done = one(params.done);
  const ctx = await getCtx();
  if (ctx.actor.type === "anonymous" || ctx.actor.type === "system") {
    redirect(`/signin?next=${encodeURIComponent(token ? `/settings/independence?token=${token}` : "/settings/independence")}`);
  }
  if (ctx.actor.type !== "learner") redirect((await resolveAfterSignIn(ctx)).path);

  const state = await getIndependenceState(ctx);
  const copy = await tMany(ctx, ["parent_view.title", "parent_view.intro", "parent_view.controls", ...PARENT_VIEW_SEES_KEYS, ...PARENT_VIEW_HIDDEN_KEYS]);
  const header = (
    <PageHeader
      title="Run your own account"
      description="Once you're 18 you can take over your account with your own email address. It's your choice, and nothing changes unless you say so."
      breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/settings" }, { label: "Run your own account" }]} />}
    />
  );
  const parentView = (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-bold">{copy["parent_view.title"]}</h2>
      <p>{copy["parent_view.intro"]}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {PARENT_VIEW_SEES_KEYS.map((key) => (
          <li key={key}>{copy[key]}</li>
        ))}
      </ul>
      <p className="font-bold">They can&apos;t see</p>
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {PARENT_VIEW_HIDDEN_KEYS.map((key) => (
          <li key={key}>{copy[key]}</li>
        ))}
      </ul>
      <p>{copy["parent_view.controls"]}</p>
    </section>
  );
  const wrap = "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8";

  if (!state.eligible) {
    return (
      <div className={wrap}>
        {header}
        <Callout tone="info" title="This opens when you're 18">
          <p>Until then, your parent or carer looks after your account with you. We only know the month and year you were born, so this page opens on the 1st of the month after your 18th birthday.</p>
        </Callout>
        {state.parentLinked && parentView}
      </div>
    );
  }

  if (state.independent) {
    return (
      <div className={wrap}>
        {header}
        {done === "own" || done === "unlinked" ? (
          <Callout tone="success" title={done === "own" ? "Done: your account is yours" : "The link has been removed"}>
            <p>You now have an account of your own, and your parent or carer no longer sees anything. We&apos;ve let them know.</p>
          </Callout>
        ) : done === "linked" ? (
          <Callout tone="success" title="Done: your account is yours">
            <p>You&apos;re still linked to your parent or carer, who can see your progress but can no longer change your account. We&apos;ve let them know.</p>
          </Callout>
        ) : null}
        <Callout tone="info" title="You run your own account">
          <p>You sign in with the same username and password, and you can reset your password yourself by email. Your privacy choices are yours to change.</p>
        </Callout>
        {state.parentLinked ? (
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">You&apos;re still linked to your parent or carer</h2>
            <p>They can still see your progress, and their plan still covers you. They can no longer reset your password, change your permissions or remove your account.</p>
            {parentView}
            <h3 className="text-lg font-bold">Remove the link</h3>
            <p className="text-ink-muted">You leave their family and get an account of your own on the Free plan. They stop seeing anything. Your work, portfolio and certificates stay with you.</p>
            <RemoveParentLinkForm />
          </section>
        ) : (
          <p>
            Your account isn&apos;t linked to a parent or carer.{" "}
            <Link href="/settings" className="link">
              Back to Settings
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (!token) {
    return (
      <div className={wrap}>
        {header}
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold">What changes if you do this</h2>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>You add your own email address, and can reset your own password.</li>
            <li>The permissions your parent or carer gave become yours to give and change.</li>
            <li>You choose whether to stay linked to them or have an account of your own.</li>
          </ul>
          <p className="font-bold">Nothing changes until you open the link we email you and confirm on the next page.</p>
        </section>
        {state.awaitingEmail && (
          <Callout tone="info" title="We've sent you a link">
            <p>Open it on this device while you&apos;re signed in. It lasts 24 hours. You can ask for a new one below.</p>
          </Callout>
        )}
        <RequestIndependenceForm />
        {state.parentLinked && parentView}
      </div>
    );
  }

  const definitions = await listConsentDefinitions(ctx);
  return (
    <div className={wrap}>
      {header}
      <Callout tone="info" title="Your email address is confirmed">
        <p>One last page. Nothing has changed yet, and nothing will unless you press the button at the bottom.</p>
      </Callout>
      <ConfirmIndependenceForm
        token={token}
        parentLinked={state.parentLinked}
        consents={definitions.map((definition) => ({
          key: definition.key,
          title: definition.title,
          body: definition.body,
          required: definition.required,
          defaultChecked: consentDefaultForBand(definition, "adult_18"),
        }))}
      />
    </div>
  );
}
