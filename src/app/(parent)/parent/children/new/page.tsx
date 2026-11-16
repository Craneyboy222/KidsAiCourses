import type { Metadata } from "next";
import { redirectIfAgeGated } from "@/app/(auth)/_lib/age-gate";
import { Breadcrumbs, Callout, PageHeader } from "@/components/ui";
import { londonYearMonth } from "@/lib/dates";
import { requireParent } from "@/server/context";
import { tMany } from "@/server/copy";
import { logWarn } from "@/server/log";
import { getEntitlementForFamily } from "@/server/services/entitlements";
import { countSeatsUsed } from "@/server/services/family";
import { checkSignupOpen, suggestAvailableUsernames } from "@/server/services/signup";
import { AddChildForm } from "./add-child-form";

export const metadata: Metadata = { title: "Add a child" };

/** Adds a child profile: nickname, birth month and year, username. Never a child's email, real name, photo, school or location. */
export default async function AddChildPage() {
  await redirectIfAgeGated();
  const ctx = await requireParent();
  const header = (
    <PageHeader
      title="Add a child"
      description="We ask for as little as we can: a nickname, the month and year they were born, and a made-up username. No email address, surname, school or photo."
      breadcrumbs={<Breadcrumbs items={[{ label: "Dashboard", href: "/parent" }, { label: "Add a child" }]} />}
    />
  );

  if (!(await checkSignupOpen(ctx))) {
    const copy = await tMany(ctx, ["signup.closed.body"]);
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        {header}
        <Callout tone="info" title="We're not adding new accounts just yet">
          <p>{copy["signup.closed.body"]}</p>
        </Callout>
      </div>
    );
  }

  // Seats come from the plan (payments slice). If that cannot be read, the form still works: adding is checked again on the server.
  let seats: { total: number; used: number } | null = null;
  try {
    const [entitlement, used] = await Promise.all([getEntitlementForFamily(ctx, ctx.actor.familyId), countSeatsUsed(ctx, ctx.actor.familyId)]);
    seats = { total: entitlement.seats, used };
  } catch (error) {
    logWarn("parent.add_child.seats_unavailable", { error: error instanceof Error ? error.message : String(error) });
  }

  const { year } = londonYearMonth(ctx.now);
  const suggestions = await suggestAvailableUsernames(ctx.db);
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {header}
      {seats && (
        <p className="text-ink-muted">
          {seats.used} of {seats.total} places on your plan are in use.
        </p>
      )}
      {/*
        The form is always rendered, even when the plan is full: it is also what shows the one-time
        code after a child has been added, and adding the last child is exactly when the plan fills up.
        A wide range of years on purpose: the form must not hint at which answers are let through.
      */}
      <AddChildForm maxYear={year} minYear={year - 30} suggestions={suggestions} full={seats ? { seats: seats.total } : null} isFull={seats !== null && seats.used >= seats.total} />
    </div>
  );
}
