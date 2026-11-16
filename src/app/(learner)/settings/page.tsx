import type { Metadata } from "next";
import Link from "next/link";
import { A11yPreferences, Badge, Card, GeneratedAvatar, PageHeader, parseA11yPrefs } from "@/components/ui";
import { PARENT_VIEW_HIDDEN_KEYS, PARENT_VIEW_SEES_KEYS } from "@/content/copy/en-GB";
import { INTEREST_TAGS } from "@/content/schema";
import { formatDate, formatMinutes } from "@/lib/dates";
import { minutesToClock } from "@/lib/learning/time-rules";
import { tMany } from "@/server/copy";
import { logWarn } from "@/server/log";
import { listNotifications } from "@/server/notifications";
import { INTEREST_LABELS, MIN_INTERESTS, newAvatarChoices } from "@/server/services/onboarding";
import { getControls, type ParentControls } from "@/server/services/parent-controls";
import { requireLearnerPage } from "../_lib/learner-page";
import { saveSettingsA11yAction } from "./actions";
import { AvatarSettingsForm, InterestsSettingsForm, MarkNoticesReadForm } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

/**
 * Learner settings (spec Section 5): profile, accessibility, "What my parent can see" and
 * notices. Available while the account is paused too, so a learner can always change how the site
 * reads and see what a parent can and cannot see.
 */
export default async function SettingsPage() {
  const page = await requireLearnerPage("/settings");
  const { ctx, summary } = page;
  const copy = await tMany(ctx, ["parent_view.title", "parent_view.intro", "parent_view.controls", ...PARENT_VIEW_SEES_KEYS, ...PARENT_VIEW_HIDDEN_KEYS]);

  let controls: ParentControls | null = null;
  try {
    controls = await getControls(ctx, page.learnerId);
  } catch (error) {
    logWarn("learner.settings.controls_unavailable", { error: error instanceof Error ? error.message : String(error) });
  }
  const notices = await listNotifications(ctx, page.learnerId, { limit: 20 });
  const hasQuietHours = controls !== null && controls.quietStartMin !== controls.quietEndMin;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader title="Settings" description="Your profile, how the site looks and reads, and what a parent or carer can see." />

      <section id="profile" aria-labelledby="profile-title" className="flex scroll-mt-24 flex-col gap-5">
        <h2 id="profile-title" className="text-2xl font-bold">
          Profile
        </h2>
        <Card className="flex flex-wrap items-center gap-4">
          <GeneratedAvatar seed={summary.avatarSeed} size="lg" />
          <dl className="flex min-w-0 flex-col gap-1">
            <div>
              <dt className="text-ink-muted text-sm font-bold">Nickname</dt>
              <dd className="font-bold">{summary.nickname}</dd>
            </div>
            <div>
              <dt className="text-ink-muted text-sm font-bold">Username (for signing in)</dt>
              <dd>{summary.username}</dd>
            </div>
          </dl>
        </Card>
        <p className="text-ink-muted">Nobody else on the site can see your profile. There are no public profiles, friends lists or leaderboards here.</p>
        {page.active ? (
          <>
            <AvatarSettingsForm choices={[summary.avatarSeed, ...newAvatarChoices(5)]} current={summary.avatarSeed} />
            <InterestsSettingsForm options={INTEREST_TAGS.map((tag) => ({ value: tag, label: INTEREST_LABELS[tag] }))} chosen={summary.interests} minimum={MIN_INTERESTS} />
          </>
        ) : (
          <p>You can change your avatar and interests once your account is switched back on.</p>
        )}
      </section>

      <section id="accessibility" aria-labelledby="accessibility-title" className="flex scroll-mt-24 flex-col gap-4">
        <h2 id="accessibility-title" className="text-2xl font-bold">
          Accessibility
        </h2>
        <A11yPreferences initial={parseA11yPrefs(summary.a11y)} onSave={saveSettingsA11yAction} headingLevel="h3" />
        <p className="text-ink-muted">These are saved to your account, so they follow you to any device you sign in on.</p>
      </section>

      <section id="parent-view" aria-labelledby="parent-view-title" className="flex scroll-mt-24 flex-col gap-3">
        <h2 id="parent-view-title" className="text-2xl font-bold">
          {copy["parent_view.title"]}
        </h2>
        <p>{copy["parent_view.intro"]}</p>
        <h3 className="text-xl font-bold">They can see</h3>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {PARENT_VIEW_SEES_KEYS.map((key) => (
            <li key={key}>{copy[key]}</li>
          ))}
        </ul>
        <h3 className="text-xl font-bold">They can&apos;t see</h3>
        <ul className="flex list-disc flex-col gap-1 pl-6">
          {PARENT_VIEW_HIDDEN_KEYS.map((key) => (
            <li key={key}>{copy[key]}</li>
          ))}
          <li>What you write in a reflection or an ethics checkpoint.</li>
          <li>Your quiz answers.</li>
        </ul>
        <p>{copy["parent_view.controls"]}</p>
        {controls && (
          <Card className="flex flex-col gap-2">
            <h3 className="text-xl font-bold">What&apos;s set on your account right now</h3>
            <ul className="flex list-disc flex-col gap-1 pl-6">
              <li>{controls.dailyMinutesCap === null ? "No daily time limit." : `Learning time: up to ${formatMinutes(controls.dailyMinutesCap)} a day.`}</li>
              <li>{hasQuietHours ? `Quiet hours: ${minutesToClock(controls.quietStartMin)} to ${minutesToClock(controls.quietEndMin)}. No learning and no notices then.` : "No quiet hours."}</li>
              {controls.requireApprovalForPro && <li>Pro projects need a parent&apos;s OK before you start them.</li>}
              {controls.paused && <li>Your account is paused at the moment.</li>}
            </ul>
          </Card>
        )}
      </section>

      <section id="notifications" aria-labelledby="notifications-title" className="flex scroll-mt-24 flex-col gap-4">
        <h2 id="notifications-title" className="text-2xl font-bold">
          Notices
        </h2>
        <p className="text-ink-muted">
          Notices only ever appear here on the site: an answer from a parent about a tool or a locked project, or news about a project you&apos;re doing. We don&apos;t send you emails or adverts, and nothing arrives
          during quiet hours.
        </p>
        {notices.length === 0 ? (
          <p>No notices yet.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {notices.map((notice) => (
                <Card as="li" key={notice.id} padding="sm" className="flex flex-col gap-1">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    {notice.href ? (
                      <Link href={notice.href} className="link">
                        {notice.title}
                      </Link>
                    ) : (
                      notice.title
                    )}
                    {!notice.read && <Badge tone="accent">New</Badge>}
                  </p>
                  <p>{notice.body}</p>
                  <p className="text-ink-muted text-sm">{formatDate(notice.at)}</p>
                </Card>
              ))}
            </ul>
            {notices.some((notice) => !notice.read) && <MarkNoticesReadForm />}
          </>
        )}
      </section>

      <section aria-labelledby="more-title" className="flex flex-col gap-3">
        <h2 id="more-title" className="text-2xl font-bold">
          More
        </h2>
        <ul className="flex flex-col gap-2">
          <li>
            <Link href="/settings/reports" className="link">
              Things you&apos;ve reported
            </Link>
          </li>
          {summary.safetyBand === "adult_18" && (
            <li>
              <Link href="/settings/independence" className="link">
                Run your own account
              </Link>
            </li>
          )}
          <li>
            <Link href="/legal/privacy-teen" className="link">
              How we look after your information
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
