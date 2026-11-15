import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  AuthShell,
  buildStudioNav,
  LearnerShell,
  MarketingShell,
  ParentShell,
  PlayerNext,
  PlayerPrevious,
  PlayerShell,
  StudioShell,
} from "@/components/layout";
import {
  AiLabel,
  Button,
  Callout,
  Card,
  CardTitle,
  Field,
  Input,
  LinkButton,
  Markdown,
  PageHeader,
  PasswordInput,
  StatGroup,
  Stat,
} from "@/components/ui";
import { assertKitAvailable } from "../../guard";

export const metadata: Metadata = { title: "Layout shells", robots: { index: false, follow: false } };

const SAMPLE = (
  <div className="flex flex-col gap-6">
    <PageHeader title="Sample page" description="Placeholder content, to show how the shell frames a page." />
    <div className="grid gap-4 sm:grid-cols-2">
      <Card variant="raised">
        <CardTitle>Keep going</CardTitle>
        <p className="text-ink-muted mt-1">Shoot a promo advert: step 3 of 8.</p>
        <LinkButton href="/dev/kit" className="mt-4">
          Continue
        </LinkButton>
      </Card>
      <Card>
        <CardTitle>Something new</CardTitle>
        <p className="text-ink-muted mt-1">Three projects were added this week.</p>
      </Card>
    </div>
  </div>
);

/** One layout shell per page, with sample props. Development and test only. */
export default async function ShellPage({ params }: { params: Promise<{ shell: string }> }) {
  assertKitAvailable();
  const { shell } = await params;

  switch (shell) {
    case "marketing":
      return (
        <MarketingShell year={2026}>
          <div className="mx-auto w-full max-w-6xl px-4 py-12">{SAMPLE}</div>
        </MarketingShell>
      );
    case "auth":
      return (
        <AuthShell
          title="Sign in"
          description="Welcome back. Pick up where you left off."
          footer={
            <p>
              New here?{" "}
              <a href="/dev/kit" className="link">
                Create an account
              </a>
            </p>
          }
        >
          <form className="flex flex-col gap-4">
            <Field label="Username">
              <Input name="username" autoComplete="username" />
            </Field>
            <Field label="Password">
              <PasswordInput name="password" />
            </Field>
            <Button type="submit" fullWidth>
              Sign in
            </Button>
          </form>
        </AuthShell>
      );
    case "learner":
      return (
        <LearnerShell
          nickname="pixel-fox"
          avatarSeed="pixel-fox"
          nav={undefined}
          notices={
            <Callout tone="info" title="Quiet hours start at 21:00">
              Your work saves as you go.
            </Callout>
          }
        >
          {SAMPLE}
        </LearnerShell>
      );
    case "parent":
      return (
        <ParentShell
          approvalsCount={2}
          currentChildId="c1"
          childLinks={[
            { id: "c1", nickname: "pixel-fox", avatarSeed: "pixel-fox", href: "/dev/kit/shells/parent" },
            { id: "c2", nickname: "moth", avatarSeed: "moth", href: "/dev/kit/shells/parent" },
          ]}
        >
          <div className="flex flex-col gap-6">
            <PageHeader title="Dashboard" description="How pixel-fox is getting on." />
            <StatGroup>
              <Stat label="Projects finished" value="4" detail="1 this month" />
              <Stat label="Time this week" value="2 hr 10 min" detail="Daily limit: 45 min" />
            </StatGroup>
          </div>
        </ParentShell>
      );
    case "studio":
      return (
        <StudioShell
          staffLabel="Signed in as the owner"
          groups={buildStudioNav((key) => key !== "staff", { review: 3, moderation: 1 })}
        >
          {SAMPLE}
        </StudioShell>
      );
    case "player":
      return (
        <PlayerShell
          courseTitle="Shoot a promo advert in an afternoon"
          lessonTitle="Plan your advert"
          exitHref="/dev/kit"
          steps={[
            { id: "1", label: "Pick your product", status: "done", href: "/dev/kit/shells/player" },
            { id: "2", label: "Write your hook", status: "current", href: "/dev/kit/shells/player" },
            { id: "3", label: "Storyboard three shots", status: "upcoming", href: "/dev/kit/shells/player" },
            { id: "4", label: "Ethics checkpoint", status: "locked" },
          ]}
          coach={<Button variant="secondary">Ask Coach</Button>}
          previous={<PlayerPrevious href="/dev/kit/shells/player" />}
          next={<PlayerNext href="/dev/kit/shells/player" />}
        >
          <div className="flex flex-col gap-4">
            <h1>Write your hook</h1>
            <Markdown>
              {
                "The first three seconds decide whether anyone keeps watching.\n\nWrite **one sentence** that makes someone stop scrolling. Then read it out loud."
              }
            </Markdown>
            <Card variant="tint" className="flex flex-col gap-2">
              <AiLabel detail="Coach can get things wrong. Check anything important." />
              <p>Who is the advert for? Start there.</p>
            </Card>
          </div>
        </PlayerShell>
      );
    default:
      notFound();
  }
}
