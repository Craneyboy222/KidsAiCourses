"use client";

import { Coins, MessageCircleQuestion, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AskParentToUnlock,
  Button,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Field,
  FormError,
  Icon,
  IconButton,
  Input,
  Pagination,
  Popover,
  ReorderList,
  ReportButton,
  Sheet,
  SubmitButton,
  Table,
  Tooltip,
  useActionForm,
  useToast,
  type ActionState,
  type ReorderItem,
  type ReportReason,
  type TableSort,
} from "@/components/ui";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const REPORT_REASONS: ReportReason[] = [
  {
    value: "danger",
    label: "Someone is in danger",
    description: "You or someone else might get hurt.",
    urgent: true,
  },
  { value: "upsetting", label: "It's upsetting or inappropriate" },
  { value: "wrong", label: "It's wrong or doesn't make sense" },
  { value: "guide_mismatch", label: "The guide doesn't match the tool any more" },
  { value: "other", label: "Something else" },
];

type Row = { id: string; name: string; steps: number };
const ROWS: Row[] = [
  { id: "1", name: "Prompt Gym", steps: 12 },
  { id: "2", name: "AI music video", steps: 18 },
  { id: "3", name: "Football stats dashboard", steps: 15 },
];

async function demoAction(
  _prev: ActionState<{ nickname: string }>,
  formData: FormData,
): Promise<ActionState<{ nickname: string }>> {
  await wait(600);
  const nickname = String(formData.get("nickname") ?? "").trim();
  if (nickname.length < 3) {
    return {
      ok: false,
      error: {
        code: "invalid_input",
        message: "Some of that didn't look right. Check the highlighted fields and try again.",
        fieldErrors: { nickname: ["Use at least 3 characters."] },
      },
    };
  }
  return { ok: true, data: { nickname } };
}

/** The components that need a click, a callback or local state. They follow the page theme, because overlays render at the top of the document. */
export function Demos() {
  const { toast } = useToast();
  const [items, setItems] = useState<ReorderItem[]>([
    { id: "a", label: "Set up your tools" },
    { id: "b", label: "Plan your advert" },
    { id: "c", label: "Film and edit" },
    { id: "d", label: "Ethics checkpoint" },
  ]);
  const [sort, setSort] = useState<TableSort>({ key: "name", direction: "asc" });
  const [page, setPage] = useState(1);
  const [asked, setAsked] = useState(false);
  const form = useActionForm(demoAction);

  const sorted = [...ROWS].sort((a, b) => {
    const order = sort.key === "steps" ? a.steps - b.steps : a.name.localeCompare(b.name);
    return sort.direction === "asc" ? order : -order;
  });

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <h3 className="border-line border-b-2 pb-1">Overlays</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Dialog
            trigger={<Button variant="secondary">Open dialog</Button>}
            title="Rename your project"
            description="This is the name on your portfolio and certificate."
            footer={
              <>
                <DialogClose>
                  <Button variant="secondary">Cancel</Button>
                </DialogClose>
                <DialogClose>
                  <Button>Save name</Button>
                </DialogClose>
              </>
            }
          >
            <Field label="Project name">
              <Input name="projectName" defaultValue="Trainer drop advert" />
            </Field>
          </Dialog>

          <ConfirmDialog
            trigger={<Button variant="secondary">Confirm dialog</Button>}
            title="Start this course again?"
            description="Your progress on this course goes back to the first step. Your finished project stays in your portfolio."
            confirmLabel="Start again"
            onConfirm={() => {
              toast({ title: "Course restarted", tone: "success" });
            }}
          />

          <ConfirmDialog
            trigger={<Button variant="danger">Take down course</Button>}
            tone="danger"
            title="Take down this course?"
            description="Learners lose access straight away. You can publish it again later from the course admin page."
            confirmLabel="Take down course"
            requireReason
            reasonLabel="Why are you taking it down?"
            onConfirm={async (reason) => {
              await wait(700);
              toast({ title: "Course taken down", description: `Reason saved: ${reason}`, tone: "success" });
            }}
          />

          <Sheet
            trigger={<Button variant="secondary">Open sheet</Button>}
            title="Coach"
            description="A side panel on wide screens, a bottom sheet on phones."
            footer={
              <DialogClose>
                <Button>Close</Button>
              </DialogClose>
            }
          >
            <p>
              Stuck on the hook? Tell me what your advert is for and I&apos;ll ask you two questions to get
              you going.
            </p>
          </Sheet>

          <Sheet
            modal={false}
            side="left"
            trigger={<Button variant="secondary">Non-modal sheet</Button>}
            title="Step notes"
          >
            <p>The page behind stays usable while this is open.</p>
          </Sheet>

          <DropdownMenu
            trigger={
              <IconButton label="More actions" variant="secondary" icon={<Icon icon={MoreHorizontal} />} />
            }
          >
            <DropdownMenuLabel>Project</DropdownMenuLabel>
            <DropdownMenuItem
              icon={<Icon icon={Pencil} size="sm" />}
              onSelect={() => toast({ title: "Rename chosen" })}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              tone="danger"
              icon={<Icon icon={Trash2} size="sm" />}
              onSelect={() => toast({ title: "Delete chosen", tone: "danger" })}
            >
              Delete project
            </DropdownMenuItem>
          </DropdownMenu>

          <Tooltip content="Each Coach message uses one credit">
            <IconButton label="About credits" variant="secondary" icon={<Icon icon={Coins} />} />
          </Tooltip>

          <Popover
            trigger={
              <Button variant="secondary" iconStart={<Icon icon={MessageCircleQuestion} />}>
                What can my parent see?
              </Button>
            }
            title="What your parent can see"
          >
            <p>
              Which courses you&apos;ve started and finished, and how long you spend. They can&apos;t read
              your Coach chats.
            </p>
          </Popover>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="border-line border-b-2 pb-1">Toasts</h3>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => toast({ title: "Draft saved" })}>
            Info toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Project submitted",
                description: "We'll tell you when it's been checked.",
                tone: "success",
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast({
                title: "Upload failed",
                description: "Check your connection and try again.",
                tone: "danger",
              })
            }
          >
            Error toast
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="border-line border-b-2 pb-1">Reorder list</h3>
        <ReorderList label="Lessons in this module" items={items} onReorder={setItems} />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="border-line border-b-2 pb-1">Sortable table and button pagination</h3>
        <Table
          caption="Courses by number of steps"
          rows={sorted}
          rowKey={(row) => row.id}
          sort={sort}
          onSort={setSort}
          columns={[
            { key: "name", header: "Course", rowHeader: true, sortable: true, cell: (row) => row.name },
            { key: "steps", header: "Steps", sortable: true, align: "end", cell: (row) => row.steps },
          ]}
        />
        <Pagination label="Demo" page={page} pageCount={5} onPageChange={setPage} />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="border-line border-b-2 pb-1">Form with useActionForm</h3>
        <form action={form.formAction} className="flex max-w-md flex-col gap-4" noValidate>
          <FormError {...form.summaryProps} fieldLabels={{ nickname: "Nickname" }} />
          <Field
            label="Nickname"
            hint="Submit it empty to see the error summary take focus."
            error={form.fieldError("nickname")}
          >
            <Input name="nickname" autoComplete="off" />
          </Field>
          <div>
            <SubmitButton pendingText="Saving…">Save nickname</SubmitButton>
          </div>
          <p role="status" className="font-bold">
            {form.succeeded && form.data ? `Saved as ${form.data.nickname}.` : ""}
          </p>
        </form>
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="border-line border-b-2 pb-1">Report and Ask a parent to unlock</h3>
        <div className="flex flex-wrap items-center gap-3">
          <ReportButton
            reasons={REPORT_REASONS}
            subject="this step"
            onSubmit={() => wait(600).then(() => undefined)}
          />
          <ReportButton
            reasons={REPORT_REASONS}
            subject="this Coach reply"
            label="Report this reply"
            appearance="button"
            onSubmit={() => wait(600).then(() => undefined)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <AskParentToUnlock
            headingLevel="h4"
            itemName="AI music video"
            asked={asked}
            onAsk={() => wait(600).then(() => setAsked(true))}
          />
          <AskParentToUnlock headingLevel="h4" asked onAsk={() => undefined} />
        </div>
        {asked && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setAsked(false)}>
              Reset the demo
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
