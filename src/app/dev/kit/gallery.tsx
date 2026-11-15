import { ArrowRight, Download, FolderOpen, Pencil, Plus, Trash2, Trophy, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { Theme } from "@/components/ui";
import {
  Accordion,
  AiLabel,
  Badge,
  Breadcrumbs,
  Button,
  Callout,
  Card,
  CardTitle,
  CATEGORY_STYLES,
  CategoryBlock,
  Checkbox,
  DifficultyBadge,
  Divider,
  EmptyState,
  ExternalToolLink,
  Field,
  FormError,
  GeneratedAvatar,
  Icon,
  IconButton,
  Input,
  LastVerified,
  LinkButton,
  LiveRegion,
  Markdown,
  MonthYearPicker,
  Pagination,
  PasswordInput,
  ProgressBar,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  Stat,
  StatGroup,
  Stepper,
  Sticker,
  SubmitButton,
  Switch,
  Table,
  Tabs,
  Textarea,
} from "@/components/ui";

const SAMPLE_MARKDOWN = `# Plan your advert

Pick **one** idea and keep it short. A good 30-second advert has:

1. A hook in the first three seconds
2. One clear message
3. A call to action

- [x] Choose a product
- [ ] Write the hook

> Tip: read it out loud. If you run out of breath, cut it.

Open [the brief](/dev/kit) or read about [storyboards](https://example.com/storyboards). Inline \`code\` looks like this.

| Shot | Seconds |
| --- | --- |
| Hook | 3 |
| Product | 20 |
`;

type Row = { id: string; course: string; level: string; minutes: number };
const ROWS: Row[] = [
  { id: "1", course: "Build your own Snapchat-style app", level: "Builder", minutes: 95 },
  { id: "2", course: "Shoot a promo advert in an afternoon", level: "Starter", minutes: 60 },
  { id: "3", course: "Prompt Gym", level: "Starter", minutes: 45 },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="border-line border-b-2 pb-1">{title}</h3>
      {children}
    </section>
  );
}

const Line = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-3">{children}</div>
);

/**
 * Every component that can render without a click, in every variant. The
 * showcase page renders this once per theme inside a `data-theme` wrapper.
 * `theme` keeps radio names and landmark labels unique across the three copies.
 */
export function Gallery({ theme }: { theme: Theme }) {
  return (
    <div className="flex flex-col gap-10">
      <Group title="Buttons">
        {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
          <Line key={variant}>
            <Button variant={variant} size="sm">
              Small {variant}
            </Button>
            <Button variant={variant}>Medium {variant}</Button>
            <Button variant={variant} size="lg">
              Large {variant}
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading loadingText="Saving…">
              Save
            </Button>
          </Line>
        ))}
        <Line>
          <Button iconStart={<Icon icon={Plus} />}>Add a step</Button>
          <Button variant="secondary" iconEnd={<Icon icon={ArrowRight} />}>
            Next
          </Button>
          <Button fullWidth variant="secondary" className="max-w-xs">
            Full width
          </Button>
        </Line>
        <Line>
          <IconButton label="Edit" icon={<Icon icon={Pencil} />} />
          <IconButton label="Download" variant="secondary" icon={<Icon icon={Download} />} />
          <IconButton label="Delete" variant="danger" size="sm" icon={<Icon icon={Trash2} size="sm" />} />
          <IconButton label="Open" variant="primary" size="lg" icon={<Icon icon={FolderOpen} size="lg" />} />
          <LinkButton href="/dev/kit">Link button</LinkButton>
          <LinkButton href="/dev/kit" variant="secondary" size="sm">
            Small link button
          </LinkButton>
          <LinkButton href="/dev/kit" variant="ghost">
            Ghost link button
          </LinkButton>
        </Line>
      </Group>

      <Group title="Form controls">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Nickname" hint="This is what we call you. Don't use your real name.">
            <Input name="nickname" autoComplete="nickname" defaultValue="pixel-fox" />
          </Field>
          <Field label="Username" error="That username is taken. Try adding a number.">
            <Input name="username" autoComplete="username" defaultValue="sam" />
          </Field>
          <Field label="Password" hint="At least 10 characters. Three random words works well.">
            <PasswordInput name="password" autoComplete="new-password" />
          </Field>
          <Field label="School year" optional>
            <Select
              name="year"
              placeholder="Choose a year"
              options={["Year 9", "Year 10", "Year 11", "Year 12", "Year 13"].map((y) => ({
                value: y,
                label: y,
              }))}
            />
          </Field>
          <Field label="What did you make?" hint="Two or three sentences is plenty.">
            <Textarea name="reflection" />
          </Field>
          <Field label="Disabled field">
            <Input name="locked" defaultValue="Can't be changed" disabled />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Checkbox
              name={`${theme}-terms`}
              label="I agree to the community code"
              description="Be kind, be honest, keep it safe."
              defaultChecked
            />
            <Checkbox name={`${theme}-updates`} label="Tell me when new projects land" />
            <Checkbox
              name={`${theme}-required`}
              label="I checked this shows no real people"
              error="Tick this to carry on."
            />
          </div>
          <div className="divide-line flex flex-col divide-y-2">
            <Switch
              name={`${theme}-quiet`}
              label="Quiet hours"
              description="No notifications between 21:00 and 07:00."
              defaultChecked
            />
            <Switch name={`${theme}-hints`} label="Show hints automatically" />
          </div>
          <RadioGroup
            legend="How do you want to start?"
            name={`${theme}-start`}
            defaultValue="guide"
            hint="You can change this later."
            options={[
              { value: "guide", label: "Follow the guide", description: "Step by step, with pictures." },
              { value: "solo", label: "Try it myself first" },
              { value: "locked", label: "Ask Coach to plan it", disabled: true },
            ]}
          />
          <RadioGroup
            legend="Text size"
            name={`${theme}-size`}
            layout="row"
            error="Choose a size."
            options={[
              { value: "s", label: "Standard" },
              { value: "l", label: "Large" },
            ]}
          />
          <MonthYearPicker
            legend="When were you born?"
            hint="Just the month and year. We never ask for the day."
            name={`${theme}Dob`}
            minYear={2005}
            maxYear={2013}
            autoComplete="bday"
          />
          <MonthYearPicker
            legend="When were you born?"
            name={`${theme}DobError`}
            minYear={2005}
            maxYear={2013}
            defaultMonth={3}
            error="Choose the year you were born."
          />
        </div>
        <FormError
          message="Some of that didn't look right. Check the highlighted fields and try again."
          fieldErrors={{
            username: ["That username is taken. Try adding a number."],
            dobYear: ["Choose the year you were born."],
          }}
          fieldLabels={{ username: "Username", dobYear: "Year of birth" }}
        />
        <form className="flex flex-wrap gap-3">
          <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
        </form>
      </Group>

      <Group title="Surfaces">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(["outline", "raised", "plain", "accent", "tint"] as const).map((variant) => (
            <Card key={variant} variant={variant}>
              <CardTitle as="h4">Card: {variant}</CardTitle>
              <p className="mt-1">A chunky surface for one idea.</p>
            </Card>
          ))}
        </div>
        <Line>
          <Badge>Neutral</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="success">Approved</Badge>
          <Badge tone="warning">Waiting</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="accent">New</Badge>
          <Badge tone="solid">Draft</Badge>
        </Line>
        <Line>
          <Sticker icon={<Icon icon={Trophy} size="sm" />}>First project</Sticker>
          <Sticker tone="primary" tilt="right">
            Free
          </Sticker>
          <Sticker tone="surface" tilt="none">
            Updated
          </Sticker>
          {(["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"] as const).map((tone, i) => (
            <Sticker
              key={tone}
              tone={tone}
              tilt={i % 2 ? "right" : "left"}
              icon={<Icon icon={Zap} size="sm" />}
            >
              Sticker {i + 1}
            </Sticker>
          ))}
        </Line>
        <div className="grid gap-4 sm:grid-cols-2">
          <Callout tone="info" title="This course uses Canva">
            <p>You&apos;ll need a parent to approve it before you start.</p>
          </Callout>
          <Callout tone="success" title="Project accepted">
            <p>It&apos;s in your portfolio and your certificate is ready.</p>
          </Callout>
          <Callout
            tone="warning"
            title="15 minutes left today"
            actions={
              <LinkButton href="/dev/kit" variant="secondary" size="sm">
                See your limits
              </LinkButton>
            }
          >
            <p>Your daily time ends at 18:30. Your work saves as you go.</p>
          </Callout>
          <Callout tone="danger" title="We couldn't accept that file">
            <p>
              It looks like it shows a real person. Swap it for a screenshot without people and send it again.
            </p>
          </Callout>
        </div>
        <EmptyState
          headingLevel="h4"
          icon={<Icon icon={FolderOpen} size="lg" />}
          title="Nothing in your portfolio yet"
          description="Finish a project and it shows up here, ready to download and show off."
          action={<LinkButton href="/dev/kit">Find a project</LinkButton>}
        />
        <StatGroup>
          <Stat label="Projects finished" value="4" detail="1 more than last month" />
          <Stat label="Time this week" value="2 hr 10 min" detail="Daily limit: 45 min" />
          <Stat label="Coach credits left" value="38" detail="Resets on 1 December 2026" />
        </StatGroup>
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-24 w-full max-w-md" />
        </div>
        <Divider />
        <Divider label="or" />
      </Group>

      <Group title="Navigation and structure">
        <Breadcrumbs
          label={`Breadcrumb (${theme})`}
          items={[
            { label: "Explore", href: "/dev/kit" },
            { label: "Video and film", href: "/dev/kit" },
            { label: "Shoot a promo advert" },
          ]}
        />
        <Tabs
          label={`Course sections (${theme})`}
          tabs={[
            { value: "about", label: "About", content: <p>What you&apos;ll make and how long it takes.</p> },
            {
              value: "tools",
              label: "Tools you'll need",
              content: <p>Canva and CapCut, both on their free plans.</p>,
            },
            { value: "locked", label: "Certificate", content: <p>Locked.</p>, disabled: true },
          ]}
        />
        <Accordion
          items={[
            {
              id: "a",
              title: "Do I need to pay for anything?",
              content: <p>No. Every project is written for the free plan of each tool.</p>,
              defaultOpen: true,
            },
            {
              id: "b",
              title: "What if I get stuck?",
              content: <p>Ask Coach for a hint. It nudges; it won&apos;t do the work for you.</p>,
            },
          ]}
        />
        <Accordion
          exclusive
          items={[
            {
              id: "c",
              title: "Only one of these opens at a time",
              content: <p>Opening the other closes this one.</p>,
            },
            {
              id: "d",
              title: "Exclusive accordion",
              content: <p>Built on native details, so it needs no JavaScript.</p>,
            },
          ]}
        />
        <Pagination
          label={`Courses (${theme})`}
          page={4}
          pageCount={12}
          hrefFor={(p) => `/dev/kit?page=${p}`}
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <Stepper
            steps={[
              { id: "1", label: "Set up Canva", status: "done", href: "/dev/kit" },
              { id: "2", label: "Write your hook", status: "current", href: "/dev/kit" },
              { id: "3", label: "Film three shots", status: "upcoming", href: "/dev/kit" },
              { id: "4", label: "Ethics checkpoint", status: "locked" },
            ]}
          />
          <div className="flex flex-col gap-4">
            <Stepper
              orientation="horizontal"
              steps={[
                { id: "1", label: "Account", status: "done" },
                { id: "2", label: "Consent", status: "current" },
                { id: "3", label: "Done", status: "upcoming" },
              ]}
            />
            <ProgressBar label="Course progress" value={3} max={8} valueText="3 of 8 steps done" />
            <ProgressBar label="Coach credits used" value={62} />
          </div>
        </div>
        <Table
          caption={`Courses in progress (${theme})`}
          rows={ROWS}
          rowKey={(row) => row.id}
          columns={[
            { key: "course", header: "Course", rowHeader: true, cell: (row) => row.course },
            { key: "level", header: "Level", cell: (row) => row.level },
            { key: "minutes", header: "Minutes", align: "end", cell: (row) => row.minutes },
          ]}
        />
        <Table
          caption={`Reports (${theme})`}
          rows={[] as Row[]}
          rowKey={(row) => row.id}
          columns={[]}
          empty={
            <EmptyState
              headingLevel="h4"
              title="No reports"
              description="Anything you report shows up here with its status."
            />
          }
        />
      </Group>

      <Group title="Feedback">
        <Line>
          <Spinner size="sm" label="Loading (small)" />
          <Spinner label="Loading" />
          <Spinner size="lg" label="Checking your file" showLabel />
        </Line>
        <LiveRegion visible className="font-bold">
          Saved at 16:42.
        </LiveRegion>
      </Group>

      <Group title="Content">
        <Markdown topHeadingLevel={4}>{SAMPLE_MARKDOWN}</Markdown>
        <Line>
          <Icon icon={Zap} size="sm" />
          <Icon icon={Zap} />
          <Icon icon={Zap} size="lg" />
          <Icon icon={Zap} size="xl" label="Quick project" />
        </Line>
      </Group>

      <Group title="Platform patterns">
        <Line>
          {["ada", "pixel-fox", "b7c1", "sam", "moth", "kite-42"].map((seed) => (
            <GeneratedAvatar key={seed} seed={seed} size="lg" label={`Avatar for ${seed}`} />
          ))}
          <GeneratedAvatar seed="ada" size="sm" />
          <GeneratedAvatar seed="ada" size="md" />
          <GeneratedAvatar seed="ada" size="xl" />
        </Line>
        <Line>
          <DifficultyBadge level="starter" />
          <DifficultyBadge level="builder" />
          <DifficultyBadge level="pro" />
          <AiLabel />
          <AiLabel detail="Coach can get things wrong. Check anything important." />
          <LastVerified date="2026-11-01T12:00:00Z" />
        </Line>
        <Line>
          {Object.keys(CATEGORY_STYLES).map((slug) => (
            <CategoryBlock
              key={slug}
              slug={slug}
              name={slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())}
              size="sm"
            />
          ))}
        </Line>
        <Line>
          <CategoryBlock slug="video-film" name="Video and film" />
          <CategoryBlock slug="games" name="Games" size="lg" />
          <CategoryBlock slug="made-up-later" name="A category added later" />
        </Line>
        <p>
          You&apos;ll build this in{" "}
          <ExternalToolLink href="https://www.canva.com" toolName="Canva" allowed>
            Canva
          </ExternalToolLink>
          . This course doesn&apos;t use{" "}
          <ExternalToolLink href="https://example.com" toolName="Blocked Tool" allowed={false} />, which
          isn&apos;t available for your age group.
        </p>
        <Line>
          <ExternalToolLink href="https://www.canva.com" toolName="Canva" allowed appearance="button" />
        </Line>
      </Group>
    </div>
  );
}
