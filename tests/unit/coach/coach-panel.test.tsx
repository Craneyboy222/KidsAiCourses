/**
 * CoachPanel in jsdom. The "server" behind `fetch` is the real Coach pipeline on in-memory
 * services with the fixture model (`createMemoryCoachDeps`), answering through the real wire
 * format (`coachResponse`), so these tests cover the browser code against what the API sends.
 *
 * Mocked: `ReportControl`. Its contract body (tools and submissions slice) still renders
 * nothing, so a stand-in button is used to prove CoachPanel puts one on every AI output and
 * points it at the right message.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachPanel, type CoachPanelProps } from "@/components/coach/CoachPanel";
import { CrisisPanel } from "@/components/coach/CrisisPanel";
import { EnergyMeter } from "@/components/coach/EnergyMeter";
import type { PlayerMode } from "@/components/course/types";
import { FALLBACK_CRISIS_SCRIPT, getCrisisScript } from "@/server/ai/crisis";
import { createMemoryCoachDeps, type MemoryOptions, type MemoryState } from "@/server/ai/memory-deps";
import { COACH_COPY, createCoachProxy, type CoachDeps, type CoachRequest } from "@/server/ai/proxy";
import { coachResponse } from "@/server/ai/wire";
import type { LearnerActor, StaffActor } from "@/server/authz/actor";
import type { Ctx } from "@/server/context";
import { axeViolations } from "../ui/axe-helper";

vi.mock("@/components/safety/ReportControl", () => ({
  ReportControl: ({ target, label }: { target: { type: string; id: string }; label?: string }) => (
    <button type="button" data-testid="report-control" data-target-type={target.type} data-target-id={target.id}>
      {label ?? "Report"}
    </button>
  ),
}));

const HINTS = ["Check which element the filter is applied to.", "A filter is one style property with a value.", "Try one built-in effect first."];
const LIVE: PlayerMode = { kind: "live", enrolmentId: "enrolment-1", learnerId: "learner-fixture" };
const PREVIEW: PlayerMode = { kind: "preview", versionId: "11111111-1111-4111-8111-111111111111", asBand: "teen_16_17", canEdit: true };
const learner: LearnerActor = { type: "learner", userId: "learner-fixture", familyId: "family-fixture", safetyBand: "teen_13_15", age: 14, status: "active" };
const editor: StaffActor = { type: "staff", userId: "staff-fixture", roles: ["editor"], twoFactorVerified: true };

type Server = { state: MemoryState; deps: CoachDeps; chatBodies: CoachRequest[]; urls: string[]; energyStatus: number };
let server: Server;

/** Stands the real pipeline up behind `fetch`. `arrange` can break or change a service first. */
function startServer(options: MemoryOptions = {}, arrange?: (deps: CoachDeps, state: MemoryState) => void, actor: Ctx["actor"] = learner): Server {
  const { deps, state } = createMemoryCoachDeps(options);
  arrange?.(deps, state);
  const proxy = createCoachProxy(deps);
  const started: Server = { state, deps, chatBodies: [], urls: [], energyStatus: 200 };
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      started.urls.push(url);
      if (url === "/api/v1/ai/credits") {
        if (started.energyStatus !== 200) return Response.json({ error: { code: "forbidden", message: "No." } }, { status: started.energyStatus });
        return Response.json({ energy: await deps.credits.energy(undefined as never, "learner-fixture", { coachCreditsPerLearnerPerMonth: state.allowance, periodKey: "2026-11" }) });
      }
      if (url === "/api/v1/ai/chat") {
        const body = JSON.parse(String(init?.body)) as CoachRequest;
        started.chatBodies.push(body);
        requests += 1;
        const ctx: Ctx = { db: undefined as never, actor, now: new Date("2026-11-16T10:00:00Z"), requestId: `panel-test-${requests}`, ip: "203.0.113.9" };
        return coachResponse(await proxy.chat(ctx, { ...body, feature: "tutor" }));
      }
      throw new Error(`Unexpected request to ${url}`);
    }),
  );
  server = started;
  return started;
}

function renderPanel(props: Partial<CoachPanelProps> = {}) {
  const onOpenChange = vi.fn();
  const view = render(<CoachPanel mode={LIVE} courseSlug="build-your-own-snapchat-style-app" stepKey="s5" stepTitle="Three built-in filters" hints={HINTS} open onOpenChange={onOpenChange} {...props} />);
  return { ...view, onOpenChange, user: userEvent.setup() };
}

const chatCalls = () => server.urls.filter((url) => url === "/api/v1/ai/chat").length;
const panel = () => screen.getByRole("dialog", { name: "Coach" });
const coachMessages = () => screen.queryAllByTestId("coach-message");
const conversation = () => screen.getByRole("list", { name: "Conversation with Coach" });

async function send(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  // While an answer is arriving the button reads "Sending…"; wait until Coach is ready again.
  const button = await screen.findByRole("button", { name: "Send to Coach" }, { timeout: 4000 });
  await user.type(screen.getByRole("textbox", { name: /Ask Coach a question/ }), text);
  await user.click(button);
}
/** Waits until the reply has finished arriving (its Report control appears only then). */
async function replyFinished(count = 1): Promise<void> {
  await waitFor(() => expect(screen.getAllByTestId("report-control")).toHaveLength(count), { timeout: 4000 });
}

beforeEach(() => {
  startServer();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hints come first", () => {
  it("'I'm stuck' gives the step's own hints one at a time, and only then asks Coach", async () => {
    const { user } = renderPanel();
    await waitFor(() => expect(screen.getByTestId("coach-energy")).toBeInTheDocument());
    expect(screen.getByText(/You'll get the step's own hints first, one at a time/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(within(conversation()).getByText(HINTS[0] ?? "")).toBeInTheDocument();
    expect(within(conversation()).getByText(/Hint 1 of 3 · written by the course team/)).toBeInTheDocument();
    expect(within(conversation()).queryByText(HINTS[1] ?? "")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Another hint" }));
    await user.click(screen.getByRole("button", { name: "Another hint" }));
    expect(within(conversation()).getByText(HINTS[2] ?? "")).toBeInTheDocument();
    // Three hints shown and still not one request to the model.
    expect(chatCalls()).toBe(0);
    expect(server.state.modelCalls).toBe(0);
    expect(coachMessages()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Still stuck? Ask Coach" }));
    await replyFinished();
    expect(chatCalls()).toBe(1);
    expect(server.state.modelCalls).toBe(1);
    expect(server.chatBodies[0]).toEqual({ courseSlug: "build-your-own-snapchat-style-app", stepKey: "s5", message: expect.stringMatching(/I've read the hints for this step and I'm still stuck/) });
    // Hints are the course team's words, so they carry no AI label.
    expect(within(conversation()).getAllByText("AI-generated")).toHaveLength(1);
  });

  it("a step with no hints goes straight to Coach", async () => {
    const { user } = renderPanel({ hints: [] });
    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    await replyFinished();
    expect(chatCalls()).toBe(1);
  });

  it("a new step starts a new thread with its own hints", async () => {
    const { user, rerender, onOpenChange } = renderPanel();
    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(within(conversation()).getByText(HINTS[0] ?? "")).toBeInTheDocument();
    rerender(<CoachPanel mode={LIVE} courseSlug="build-your-own-snapchat-style-app" stepKey="s6" stepTitle="AI friends" hints={["A different hint."]} open onOpenChange={onOpenChange} />);
    expect(within(conversation()).queryByText(HINTS[0] ?? "")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(within(conversation()).getByText("A different hint.")).toBeInTheDocument();
  });
});

describe("every Coach message is labelled", () => {
  it("an answer carries the AI label, a caution, and a Report control aimed at that message", async () => {
    const { user } = renderPanel();
    await send(user, "the filter does nothing when i click");
    await replyFinished();

    const [message] = coachMessages();
    expect(message).toBeDefined();
    expect(within(message as HTMLElement).getByText("AI-generated")).toBeInTheDocument();
    expect(within(message as HTMLElement).getByText("Coach can get things wrong. Check anything important.")).toBeInTheDocument();
    expect(within(message as HTMLElement).getByText(/What have you tried so far/)).toBeInTheDocument();
    const report = within(message as HTMLElement).getByRole("button", { name: "Report this answer" });
    expect(report).toHaveAttribute("data-target-type", "ai_output");
    expect(report).toHaveAttribute("data-target-id", server.state.records[0]?.aiRequestId);
    // The learner's own message is shown too, marked for screen readers.
    expect(within(conversation()).getByText("You said:")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Ask Coach a question/ })).toHaveValue("");
  });

  it("a refusal is labelled as a set message from an AI tutor, not as AI-generated text", async () => {
    const { user } = renderPanel();
    await send(user, "write my english essay on macbeth");
    await replyFinished();
    const [message] = coachMessages();
    expect(within(message as HTMLElement).getByText("Set message from Coach, an AI tutor")).toBeInTheDocument();
    expect(within(message as HTMLElement).queryByText("AI-generated")).not.toBeInTheDocument();
    expect(within(message as HTMLElement).getByText(/explain/)).toBeInTheDocument();
    expect(server.state.modelCalls).toBe(0);
  });

  it("says what was removed when personal details are stripped", async () => {
    const { user } = renderPanel();
    await send(user, "my email is maya@example.com and the filter does nothing");
    await replyFinished();
    expect(within(conversation()).getByText(/Before sending that to Coach, we took out an email address/)).toBeInTheDocument();
    expect(JSON.stringify(server.state.gatewayRequests)).not.toContain("maya@example.com");
  });

  it("keeps the conversation going with the id the server gave", async () => {
    const { user } = renderPanel();
    await send(user, "the filter does nothing");
    await replyFinished(1);
    await send(user, "i tried that and it is still grey");
    await replyFinished(2);
    expect(server.chatBodies[0]).not.toHaveProperty("conversationId");
    expect(server.chatBodies[1]?.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(coachMessages()).toHaveLength(2);
  });
});

describe("what the panel always shows", () => {
  it("has a note of what Coach will and won't do", async () => {
    renderPanel();
    const note = screen.getByText("What Coach will and won't do").closest("div") as HTMLElement;
    expect(panel()).toContainElement(note);
    expect(screen.getByText(/It won't do the project for you, or write homework, essays or exam answers\./)).toBeInTheDocument();
    expect(screen.getByText(/It will never ask for your name, address, passwords, codes or card details/)).toBeInTheDocument();
    expect(screen.getByText(/It's an AI, so it can get things wrong/)).toBeInTheDocument();
    expect(panel()).toHaveAccessibleDescription(/An AI tutor for “Three built-in filters”/);
  });

  it("shows energy as a meter with words, and never a price", async () => {
    const { user } = renderPanel();
    const meter = await screen.findByRole("progressbar", { name: "Coach energy" });
    expect(meter).toHaveAttribute("aria-valuetext", "50 of 50 left");
    expect(screen.getByText(/It tops up on 1 December 2026\. Hints on the step are always free\./)).toBeInTheDocument();

    await send(user, "the filter does nothing");
    await replyFinished();
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Coach energy" })).toHaveAttribute("aria-valuetext", "49 of 50 left"));
    expect(document.body.textContent).not.toMatch(/£|\bpence\b|\bprice|\bcredits?\b|\bbuy\b|upgrade|subscribe/i);
  });

  it("announces replies politely, once they are complete", async () => {
    const { user } = renderPanel();
    const live = within(panel()).getAllByRole("status")[0] as HTMLElement;
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveAttribute("aria-atomic", "true");
    expect(live).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(live).toHaveTextContent(`Hint 1 of 3: ${HINTS[0]}`);
    await send(user, "the filter does nothing");
    await replyFinished();
    await waitFor(() => expect(live).toHaveTextContent(/^Coach says: .*What have you tried so far/));
  });

  it("lets the learner paste into the message box", async () => {
    const { user } = renderPanel();
    const box = screen.getByRole("textbox", { name: /Ask Coach a question/ });
    await user.click(box);
    await user.paste("TypeError: preview is undefined at line 12");
    expect(box).toHaveValue("TypeError: preview is undefined at line 12");
    expect(box).not.toHaveAttribute("onpaste");
    expect(box).toHaveAttribute("maxlength", "2000");
  });
});

describe("keyboard and accessible names", () => {
  it("can be used with the keyboard alone: Tab to each control, Enter for hints, Ctrl+Enter to send", async () => {
    const { user } = renderPanel();
    await screen.findByTestId("coach-energy");
    const stuck = screen.getByRole("button", { name: "I'm stuck" });
    const box = screen.getByRole("textbox", { name: /Ask Coach a question/ });
    const sendButton = screen.getByRole("button", { name: "Send to Coach" });

    stuck.focus();
    await user.keyboard("{Enter}");
    expect(within(conversation()).getByText(HINTS[0] ?? "")).toBeInTheDocument();
    await user.tab();
    expect(box).toHaveFocus();
    await user.keyboard("the filter does nothing");
    await user.tab();
    expect(sendButton).toHaveFocus();
    await user.tab({ shift: true });
    await user.keyboard("{Control>}{Enter}{/Control}");
    await replyFinished();
    expect(server.chatBodies[0]?.message).toBe("the filter does nothing");

    // The Report control on the answer can be reached too.
    expect(screen.getByRole("button", { name: "Report this answer" })).not.toHaveAttribute("tabindex", "-1");
    await user.keyboard("{Escape}");
  });

  it("gives every control a name and passes axe, with a conversation in view", async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    await send(user, "the filter does nothing");
    await replyFinished();

    expect(panel()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Ask Coach" })).toBeInTheDocument();
    for (const button of within(panel()).getAllByRole("button")) expect(button).toHaveAccessibleName();
    expect(screen.getByRole("textbox", { name: /Ask Coach a question/ })).toHaveAccessibleDescription(/Leave out personal details/);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("does nothing when Send is pressed with an empty box", async () => {
    const { user } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Send to Coach" }));
    expect(chatCalls()).toBe(0);
  });
});

describe("the crisis panel", () => {
  it("shows the fixed script in its own calm panel, with numbers that can be tapped, and never as AI-generated text", async () => {
    const { user } = renderPanel();
    await send(user, "i dont want to be here anymore");
    const crisis = await screen.findByTestId("coach-crisis");
    await replyFinished();

    expect(crisis).toHaveAttribute("role", "group");
    expect(crisis).toHaveAccessibleName("Thank you for telling me");
    expect(within(crisis).getByRole("heading", { level: 3, name: "Thank you for telling me" })).toBeInTheDocument();
    expect(within(crisis).getByRole("link", { name: "Call Childline on 0800 1111" })).toHaveAttribute("href", "tel:08001111");
    expect(within(crisis).getByRole("link", { name: "Call Samaritans on 116 123" })).toHaveAttribute("href", "tel:116123");
    expect(within(crisis).getByRole("link", { name: "Shout: Text SHOUT to 85258" })).toHaveAttribute("href", "sms:85258?body=SHOUT");
    expect(within(crisis).getByRole("link", { name: "Call Emergency services on 999" })).toHaveAttribute("href", "tel:999");
    expect(within(crisis).getByText("If you or someone else is in danger right now, call 999.")).toBeInTheDocument();
    expect(within(crisis).getByText(/Please talk to an adult you trust/)).toBeInTheDocument();
    expect(within(crisis).getByText("Set message from Coach, an AI tutor")).toBeInTheDocument();
    expect(within(crisis).queryByText("AI-generated")).not.toBeInTheDocument();
    // It is its own panel, not an ordinary Coach bubble, and it is not rendered from model text.
    expect(coachMessages()).toHaveLength(0);
    expect(server.state.modelCalls).toBe(0);
    expect(screen.getByTestId("report-control")).toHaveAttribute("data-target-type", "ai_output");

    const live = within(panel()).getAllByRole("status")[0] as HTMLElement;
    await waitFor(() => expect(live).toHaveTextContent(/Thank you for telling me\. There are people you can talk to right now\. Childline is free on 0800 1111/));
    // Calm: no error styling, no alert role, nothing that reads as a telling-off.
    expect(within(panel()).queryByRole("alert")).not.toBeInTheDocument();
    expect(crisis.className).not.toMatch(/danger|error/);
  });

  it("can appear twice in one thread without clashing ids, and passes axe", async () => {
    const { user } = renderPanel();
    await send(user, "i dont want to be here anymore");
    await replyFinished(1);
    await send(user, "my dad hits me");
    await replyFinished(2);
    const panels = screen.getAllByTestId("coach-crisis");
    expect(panels).toHaveLength(2);
    const ids = panels.map((element) => element.getAttribute("aria-labelledby"));
    expect(new Set(ids).size).toBe(2);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("renders the approved script from data, and the built-in fallback has the same four signposts", () => {
    for (const script of [getCrisisScript(), FALLBACK_CRISIS_SCRIPT]) {
      const { unmount } = render(<CrisisPanel script={script} label="Set message from Coach, an AI tutor" />);
      for (const href of ["tel:08001111", "tel:116123", "sms:85258?body=SHOUT", "tel:999"]) {
        expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
      }
      for (const link of screen.getAllByRole("link")) expect(link.className).toMatch(/min-h-12/);
      unmount();
    }
  });
});

describe("friendly states when Coach is not available", () => {
  const cases: Array<[string, (deps: CoachDeps, state: MemoryState) => void, string, RegExp]> = [
    ["out of energy", (_deps, state) => void (state.balance = 0), "Out of Coach energy", /You're out of Coach energy for now\. It tops up on 1 December 2026\..*a parent or carer can see the options/],
    ["AI break", (_deps, state) => void (state.settings.killSwitch = true), "AI break — back soon", /Coach is having a rest, but your steps and hints still work/],
    ["quiet hours", (deps) => void (deps.people.learningAllowed = async () => ({ allowed: false, reason: "quiet_hours", message: "It's quiet hours, so Coach is resting. It'll be back in the morning." })), "It's quiet hours", /Coach is resting/],
    ["time cap", (deps) => void (deps.people.learningAllowed = async () => ({ allowed: false, reason: "time_cap", message: "You've used today's time. Your work is saved for tomorrow." })), "That's your time for today", /Your work is saved/],
    ["missing consent", (deps) => void (deps.people.hasConsent = async () => false), "Coach needs a grown-up's OK", /Coach needs a parent or carer to say yes to AI help first\. Ask them to check the permissions in their dashboard/],
    ["age assurance not finished", (deps) => void (deps.people.ageAssured = async () => false), "Coach isn't switched on yet", /A parent or carer needs to finish a quick check first/],
    ["a paused account", (deps) => void (deps.people.learningAllowed = async () => ({ allowed: false, reason: "paused", message: COACH_COPY.paused })), "Your account is paused", /A parent or carer can sort it out from their dashboard/],
  ];

  it.each(cases)("%s: a calm explanation, no price, and the hints still work", async (_name, arrange, title, message) => {
    startServer({}, arrange);
    const { user } = renderPanel();
    await send(user, "the filter does nothing");

    const heading = await screen.findByText(title);
    const notice = heading.closest("[role='status']") as HTMLElement;
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(message);
    expect(notice).toHaveTextContent("The hints for this step are still here whenever you need them.");
    expect(server.state.modelCalls).toBe(0);
    expect(coachMessages()).toHaveLength(0);
    // Under-18s never see money, a checkout or an upsell.
    expect(document.body.textContent).not.toMatch(/£|\bpence\b|\bprice|\bpay\b|\bbuy\b|upgrade|subscribe|checkout/i);
    expect(within(panel()).queryByRole("link")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I'm stuck" }));
    expect(within(conversation()).getByText(HINTS[0] ?? "")).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("keeps the message box, so a learner who is out of energy can still reach the support script", async () => {
    startServer({ balance: 0 });
    const { user } = renderPanel();
    await send(user, "the filter does nothing");
    await screen.findByText("Out of Coach energy");

    await send(user, "honestly i want to kill myself");
    expect(await screen.findByTestId("coach-crisis")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call Childline on 0800 1111" })).toBeInTheDocument();
    await waitFor(() => expect(server.state.cases).toHaveLength(1));
    // The "out of energy" notice has gone: the script is what matters now.
    await waitFor(() => expect(screen.queryByText("Out of Coach energy")).not.toBeInTheDocument());
  });

  it("takes the message box away only when the learner is signed out", async () => {
    startServer({}, undefined, { type: "anonymous" });
    const { user } = renderPanel();
    await send(user, "the filter does nothing");
    expect(await screen.findByText("You're signed out")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Ask Coach a question/ })).not.toBeInTheDocument();
  });

  it("says so plainly when the request cannot reach the server, and lets the learner try again", async () => {
    const { user } = renderPanel();
    await screen.findByTestId("coach-energy");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await send(user, "the filter does nothing");
    const notice = (await screen.findByText("That didn't go through")).closest("[role='status']") as HTMLElement;
    expect(notice).toHaveTextContent("Coach couldn't be reached. Check your connection and try again.");
    expect(screen.getByRole("button", { name: "Send to Coach" })).toBeEnabled();
    expect(coachMessages()).toHaveLength(0);
  });

  it("does not leave a half-arrived answer looking as if it is still coming", async () => {
    const { user } = renderPanel();
    await screen.findByTestId("coach-energy");
    const meta = { kind: "reply", code: "ok", aiGenerated: true, label: "AI-generated", notices: [], conversationId: null, messageId: "22222222-2222-4222-8222-222222222222", crisis: null, preview: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          // The first read delivers the start of an answer; the next finds the connection gone.
          pull(controller) {
            pulls += 1;
            if (pulls === 1) controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify(meta)}\n\nevent: delta\ndata: ${JSON.stringify({ text: "What have you " })}\n\n`));
            else controller.error(new Error("connection dropped"));
          },
        });
        return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    await send(user, "the filter does nothing");
    expect(await screen.findByText("That didn't go through")).toBeInTheDocument();
    // What did arrive keeps its label and gets its Report control.
    const [message] = coachMessages();
    expect(within(message as HTMLElement).getByText("AI-generated")).toBeInTheDocument();
    expect(within(message as HTMLElement).getByRole("button", { name: "Report this answer" })).toHaveAttribute("data-target-id", meta.messageId);
  });
});

describe("staff preview", () => {
  it("is marked 'Staff preview — nothing is saved', has no energy meter, and sends the preview details", async () => {
    startServer({}, undefined, editor);
    const { user } = renderPanel({ mode: PREVIEW });
    expect(screen.getByText("Staff preview — nothing is saved")).toBeInTheDocument();
    await send(user, "the filter does nothing");
    await replyFinished();

    expect(server.urls).not.toContain("/api/v1/ai/credits");
    expect(screen.queryByTestId("coach-energy")).not.toBeInTheDocument();
    expect(server.chatBodies[0]?.preview).toEqual({ versionId: PREVIEW.versionId, asBand: "teen_16_17", turn: 0 });
    expect(server.state.records[0]).toMatchObject({ isPreview: true, content: null, conversation: null });
    expect(server.state.charged).toBe(0);
    expect(within(coachMessages()[0] as HTMLElement).getByText("AI-generated")).toBeInTheDocument();

    await send(user, "still nothing");
    await replyFinished(2);
    expect(server.chatBodies[1]?.preview).toMatchObject({ turn: 1 });
    expect(server.chatBodies[1]).not.toHaveProperty("conversationId");
  });

  it("a learner's panel carries no preview marker", () => {
    renderPanel();
    expect(screen.queryByText(/Staff preview/)).not.toBeInTheDocument();
  });
});

describe("EnergyMeter", () => {
  it("never shows more than the bar can hold, and copes with an allowance of nothing", () => {
    const { rerender } = render(<EnergyMeter energy={{ balance: 70, monthlyAllowance: 50, percent: 100, resetsAt: "2026-12-01T00:00:00.000Z" }} />);
    expect(screen.getByRole("progressbar", { name: "Coach energy" })).toHaveAttribute("aria-valuetext", "70 of 50 left");
    rerender(<EnergyMeter energy={{ balance: 0, monthlyAllowance: 0, percent: 0, resetsAt: "2026-12-01T00:00:00.000Z" }} />);
    expect(screen.getByRole("progressbar", { name: "Coach energy" })).toHaveAttribute("aria-valuetext", "0 of 0 left");
    expect(document.body.textContent).not.toMatch(/£/);
  });
});

describe("closing", () => {
  it("tells the player when the learner closes it", async () => {
    const { user, onOpenChange } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => undefined);
  });
});
