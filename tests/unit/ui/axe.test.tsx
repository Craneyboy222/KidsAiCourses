import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderOpen } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
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
  A11yPreferences,
  Accordion,
  AiLabel,
  AskParentToUnlock,
  Badge,
  Breadcrumbs,
  Button,
  Callout,
  Card,
  CardTitle,
  CategoryBlock,
  Checkbox,
  ConfirmDialog,
  DifficultyBadge,
  EmptyState,
  ExternalToolLink,
  Field,
  FormError,
  GeneratedAvatar,
  Icon,
  Input,
  LastVerified,
  LinkButton,
  Markdown,
  MonthYearPicker,
  PageHeader,
  Pagination,
  PasswordInput,
  ProgressBar,
  RadioGroup,
  ReorderList,
  ReportButton,
  Select,
  Spinner,
  Stat,
  StatGroup,
  Stepper,
  Sticker,
  Switch,
  Table,
  Tabs,
  Textarea,
} from "@/components/ui";
import { axeViolations } from "./axe-helper";

vi.mock("next/navigation", () => ({ usePathname: () => "/explore" }));

const REASONS = [
  { value: "danger", label: "Someone is in danger", urgent: true },
  { value: "wrong", label: "It's wrong or doesn't make sense" },
];

describe("automated accessibility checks (axe-core)", () => {
  it("a sign-up form with hints, errors and grouped controls has no violations", async () => {
    render(
      <AuthShell
        title="Create your account"
        description="It takes about two minutes."
        footer={
          <LinkButton href="/signin" variant="ghost">
            I already have an account
          </LinkButton>
        }
      >
        <form className="flex flex-col gap-4">
          <FormError
            message="Some of that didn't look right. Check the highlighted fields and try again."
            fieldErrors={{ username: ["That username is taken."] }}
            fieldLabels={{ username: "Username" }}
          />
          <Field label="Username" hint="Don't use your real name." error="That username is taken.">
            <Input name="username" autoComplete="username" />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <PasswordInput name="password" autoComplete="new-password" />
          </Field>
          <Field label="School year" optional>
            <Select name="year" placeholder="Choose a year" options={[{ value: "9", label: "Year 9" }]} />
          </Field>
          <Field label="Anything we should know?" optional>
            <Textarea name="notes" />
          </Field>
          <MonthYearPicker
            legend="When were you born?"
            name="dob"
            minYear={2005}
            maxYear={2013}
            error="Choose the year you were born."
          />
          <RadioGroup
            legend="How do you want to start?"
            name="start"
            options={[
              { value: "guide", label: "Follow the guide", description: "Step by step." },
              { value: "solo", label: "Try it myself" },
            ]}
          />
          <Checkbox name="code" label="I agree to the community code" error="Tick this to carry on." />
          <Switch name="hints" label="Show hints automatically" description="You can change this later." />
          <Button type="submit" loading loadingText="Creating your account…">
            Create account
          </Button>
        </form>
      </AuthShell>,
    );
    expect(await axeViolations()).toEqual([]);
  });

  it("a learner page with cards, badges, progress and platform patterns has no violations", async () => {
    render(
      <LearnerShell
        nickname="pixel-fox"
        avatarSeed="pixel-fox"
        notices={
          <Callout tone="warning" title="15 minutes left today">
            Your work saves as you go.
          </Callout>
        }
      >
        <PageHeader
          title="Shoot a promo advert in an afternoon"
          description="Plan, film and edit a 30-second advert."
          breadcrumbs={
            <Breadcrumbs
              items={[{ label: "Explore", href: "/explore" }, { label: "Shoot a promo advert" }]}
            />
          }
          eyebrow={
            <>
              <CategoryBlock slug="video-film" name="Video and film" size="sm" />
              <DifficultyBadge level="starter" />
              <Badge tone="success">Free</Badge>
              <Sticker>New</Sticker>
            </>
          }
          actions={<LinkButton href="/learn/advert">Start</LinkButton>}
        />
        <LastVerified date="2026-11-01T12:00:00Z" />
        <StatGroup>
          <Stat label="Steps" value="8" detail="About 60 minutes" />
        </StatGroup>
        <ProgressBar label="Course progress" value={3} max={8} valueText="3 of 8 steps done" />
        <Stepper
          steps={[
            { id: "1", label: "Set up Canva", status: "done", href: "/learn/1" },
            { id: "2", label: "Write your hook", status: "current", href: "/learn/2" },
            { id: "3", label: "Ethics checkpoint", status: "locked" },
          ]}
        />
        <Card as="section" aria-label="Coach reply">
          <AiLabel detail="Coach can get things wrong." />
          <Markdown>{"Who is the advert **for**? Read [this guide](https://example.com/guide)."}</Markdown>
          <ReportButton reasons={REASONS} subject="this Coach reply" onSubmit={() => undefined} />
        </Card>
        <p>
          You&apos;ll build this in <ExternalToolLink href="https://www.canva.com" toolName="Canva" allowed />{" "}
          and not in <ExternalToolLink href="https://x.example" toolName="Other Tool" allowed={false} />.
        </p>
        <AskParentToUnlock itemName="AI music video" asked={false} onAsk={() => undefined} />
        <AskParentToUnlock asked onAsk={() => undefined} headingLevel="h3" />
        <Tabs
          label="Course sections"
          tabs={[
            { value: "a", label: "About", content: <p>About this course.</p> },
            { value: "b", label: "Tools", content: <p>Tools.</p> },
          ]}
        />
        <Accordion items={[{ id: "q1", title: "Do I need to pay?", content: <p>No.</p> }]} />
        <EmptyState
          headingLevel="h2"
          icon={<Icon icon={FolderOpen} />}
          title="Nothing here yet"
          description="Finish a project and it shows up here."
          action={<LinkButton href="/explore">Find a project</LinkButton>}
        />
        <Spinner label="Loading your projects" />
        <GeneratedAvatar seed="moth" label="Avatar for moth" />
      </LearnerShell>,
    );
    // The current tab is marked for assistive technology, not just coloured.
    expect(screen.getByRole("link", { name: "Explore", current: "page" })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });

  it("a parent page with the child switcher, a table and pagination has no violations", async () => {
    render(
      <ParentShell
        approvalsCount={2}
        currentChildId="c1"
        childLinks={[
          { id: "c1", nickname: "pixel-fox", avatarSeed: "u1", href: "/parent/children/c1" },
          { id: "c2", nickname: "moth", avatarSeed: "u2", href: "/parent/children/c2" },
        ]}
      >
        <PageHeader title="Dashboard" description="How pixel-fox is getting on." />
        <Table
          caption="Courses in progress"
          rows={[{ id: "1", course: "Prompt Gym", minutes: 45 }]}
          rowKey={(row) => row.id}
          sort={{ key: "course", direction: "asc" }}
          onSort={() => undefined}
          columns={[
            { key: "course", header: "Course", rowHeader: true, sortable: true, cell: (row) => row.course },
            { key: "minutes", header: "Minutes", align: "end", sortable: true, cell: (row) => row.minutes },
          ]}
        />
        <Pagination label="Courses" page={2} pageCount={9} hrefFor={(p) => `/parent?page=${p}`} />
        <A11yPreferences headingLevel="h2" />
      </ParentShell>,
    );
    const switcher = screen.getByRole("navigation", { name: "Your children" });
    expect(switcher).toHaveTextContent("pixel-fox");
    expect(screen.getByRole("link", { name: "Add a child" })).toHaveAttribute("href", "/parent/children/new");
    expect(screen.getByRole("link", { name: "Approvals 2 waiting" })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });

  it("the Studio shell with a reorder list and an open reason dialog has no violations", async () => {
    render(
      <StudioShell
        groups={buildStudioNav((key) => key !== "staff" && key !== "plans", { review: 3 })}
        staffLabel="Signed in as the owner"
      >
        <PageHeader title="Edit course" />
        <ReorderList
          label="Lessons in this module"
          items={[
            { id: "a", label: "Set up" },
            { id: "b", label: "Plan" },
          ]}
          onReorder={() => undefined}
        />
        <ConfirmDialog
          trigger={<Button variant="danger">Take down course</Button>}
          tone="danger"
          title="Take down this course?"
          description="Learners lose access straight away."
          confirmLabel="Take it down"
          requireReason
          onConfirm={() => undefined}
        />
      </StudioShell>,
    );
    // Items the member of staff may not see are not rendered at all.
    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plans" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Staff area").length).toBeGreaterThan(0);
    expect(await axeViolations()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Take down course" }));
    await userEvent.click(screen.getByRole("button", { name: "Take it down" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    // While a modal is open the page behind is hidden from assistive technology, so check the dialog itself.
    expect(await axeViolations(screen.getByRole("alertdialog"))).toEqual([]);
  });

  it("the player and marketing shells have no violations", async () => {
    const { unmount } = render(
      <PlayerShell
        courseTitle="Shoot a promo advert in an afternoon"
        lessonTitle="Plan your advert"
        exitHref="/explore/advert"
        steps={[
          { id: "1", label: "Pick your product", status: "done", href: "/learn/1" },
          { id: "2", label: "Write your hook", status: "current", href: "/learn/2" },
        ]}
        coach={<Button variant="secondary">Ask Coach</Button>}
        previous={<PlayerPrevious href="/learn/1" />}
        next={<PlayerNext href="/learn/3" />}
      >
        <h1>Write your hook</h1>
        <Card>
          <CardTitle>What to do</CardTitle>
          <p>Write one sentence that makes someone stop scrolling.</p>
        </Card>
      </PlayerShell>,
    );
    expect(screen.getByRole("navigation", { name: "Previous and next step" })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
    unmount();

    render(
      <MarketingShell year={2026}>
        <h1>Make things with AI</h1>
      </MarketingShell>,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/signin");
    expect(screen.getByRole("link", { name: "Get started" })).toBeInTheDocument();
    expect(await axeViolations()).toEqual([]);
  });
});
