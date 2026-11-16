import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionState } from "@/server/action";
import { axeViolations } from "../ui/axe-helper";

/**
 * Component tests for the account forms whose logic lives in the browser: which step is shown,
 * what is never asked of a child, and what survives a refused submission. The Server Actions
 * are replaced with mocks (they need a server); what each one receives is checked instead.
 */
const actions = vi.hoisted(() => ({
  teenAge: vi.fn(),
  teenDetails: vi.fn(),
  adultDetails: vi.fn(),
  signUpParent: vi.fn(),
  resendApproval: vi.fn(),
  addChild: vi.fn(),
  saveConsents: vi.fn(),
  signInLearner: vi.fn(),
  signInEmail: vi.fn(),
  sendMagicLink: vi.fn(),
  redeemInvite: vi.fn(),
}));
vi.mock("@/app/(auth)/signup/actions", () => ({
  teenAgeAction: actions.teenAge,
  teenDetailsAction: actions.teenDetails,
  adultDetailsAction: actions.adultDetails,
  signUpParentAction: actions.signUpParent,
  resendApprovalAction: actions.resendApproval,
}));
vi.mock("@/app/(parent)/parent/children/actions", () => ({ addChildAction: actions.addChild, saveConsentsAction: actions.saveConsents }));
vi.mock("@/app/(auth)/signin/actions", () => ({ signInLearnerAction: actions.signInLearner, signInEmailAction: actions.signInEmail, sendMagicLinkAction: actions.sendMagicLink }));
vi.mock("@/app/(auth)/join/actions", () => ({ redeemInviteAction: actions.redeemInvite }));

const { TeenSignupForm } = await import("@/app/(auth)/signup/teen/teen-signup-form");
const { ParentSignupForm } = await import("@/app/(auth)/signup/parent/parent-signup-form");
const { AddChildForm } = await import("@/app/(parent)/parent/children/new/add-child-form");
const { ConsentForm } = await import("@/app/(parent)/parent/children/[id]/consent/consent-form");
const { EmailSignInForm, LearnerSignInForm } = await import("@/app/(auth)/signin/sign-in-forms");
const { JoinForm } = await import("@/app/(auth)/join/join-form");
const { ConsentFields } = await import("@/app/(auth)/_components/consent-fields");
const { ActionForm, Field, FormError, Input, SubmitButton, useActionForm } = await import("@/components/ui");

const fail = (message: string, fieldErrors?: Record<string, string[]>): ActionState<never> => ({ ok: false, error: { code: "invalid_input", message, fieldErrors } });
const sent = (call: number, mock: ReturnType<typeof vi.fn>): Record<string, FormDataEntryValue | FormDataEntryValue[]> => {
  const data = mock.mock.calls[call]?.[1] as FormData;
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(data.keys())) out[key] = data.getAll(key).length > 1 ? data.getAll(key) : (data.get(key) as FormDataEntryValue);
  return out;
};

const CONSENTS = [
  { key: "account_learning_data", title: "Account and learning data", body: "First paragraph.\n\nSecond paragraph.", required: true },
  { key: "ai_processing", title: "Coach: our built-in AI helper", body: "Coach wording.", required: true },
  { key: "third_party_tools", title: "Using tools from other companies", body: "Tools wording.", required: true },
  { key: "tutor_history_retention", title: "Keep Coach conversations for longer (optional)", body: "Optional wording.", required: false },
];
const TEEN_COPY = { noEmail: "You don't need an email address.", deletedAfter7Days: "Deleted after 7 days if nobody approves.", lockedUntilApproved: "Locked until approved." };

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
});

describe("ActionForm with useActionForm", () => {
  function Demo({ action }: { action: (prev: ActionState<{ done: true }>, data: FormData) => Promise<ActionState<{ done: true }>> }) {
    const form = useActionForm(action);
    return (
      <ActionForm action={form.formAction} aria-label="Demo">
        <FormError {...form.summaryProps} />
        <Field label="Username" error={form.fieldError("username")}>
          <Input name="username" />
        </Field>
        <SubmitButton loading={form.pending} name="intent" value="save">
          Save
        </SubmitButton>
        {form.succeeded && <p>Saved</p>}
      </ActionForm>
    );
  }

  it("sends the fields and the button that was pressed, and keeps what was typed when the action refuses", async () => {
    const action = vi.fn().mockResolvedValueOnce(fail("That username is taken.", { username: ["Try another."] })).mockResolvedValueOnce({ ok: true, data: { done: true } });
    const user = userEvent.setup();
    render(<Demo action={action} />);
    await user.type(screen.getByLabelText("Username"), "pixel_wren");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That username is taken.");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(sent(0, action)).toEqual({ username: "pixel_wren", intent: "save" });
    // React would have cleared the box; this form does not.
    expect(screen.getByLabelText("Username")).toHaveValue("pixel_wren");
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TeenSignupForm", () => {
  const renderForm = () => render(<TeenSignupForm maxYear={2026} minYear={1996} consents={CONSENTS} copy={TEEN_COPY} />);

  async function answerAge(user: ReturnType<typeof userEvent.setup>, month: string, yearValue: string) {
    await user.selectOptions(screen.getByLabelText("Month"), month);
    await user.selectOptions(screen.getByLabelText("Year"), yearValue);
    await user.click(screen.getByRole("button", { name: "Continue" }));
  }

  it("asks only for the month and year first: no username, password or email is on the page", () => {
    renderForm();
    expect(screen.getByRole("group", { name: "When were you born?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Month")).toBeRequired();
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    // Never a day of birth, a name or a school.
    expect(screen.queryByLabelText(/day/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/name$/i)).not.toBeInTheDocument();
    // The years on offer do not hint at which answers are let through.
    const years = within(screen.getByLabelText("Year")).getAllByRole("option").map((o) => o.textContent);
    expect(years).toContain("2020");
    expect(years).toContain("1996");
  });

  it("for a teenager, then asks for a username, a password and a parent's email, and says plainly what happens after 7 days", async () => {
    actions.teenAge.mockResolvedValue({ ok: true, data: { route: "teen", birthMonth: 5, birthYear: 2012, suggestions: ["brave_otter_482", "calm_fox_301", "sunny_wren_555"] } });
    const user = userEvent.setup();
    renderForm();
    await answerAge(user, "5", "2012");
    expect(sent(0, actions.teenAge)).toEqual({ birthMonth: "5", birthYear: "2012" });

    const username = await screen.findByLabelText("Username");
    expect(username).toHaveAccessibleDescription(/brave_otter_482, calm_fox_301, sunny_wren_555/);
    expect(screen.getByLabelText("Your parent or carer's email address")).toHaveAccessibleDescription(/You don't need an email address/);
    expect(screen.getByText("Deleted after 7 days if nobody approves.")).toBeInTheDocument();
    expect(screen.getByText("Locked until approved.")).toBeInTheDocument();
    // The teen is never asked for an email address of their own, and never shown consents to give.
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("autocomplete", "new-password");

    actions.teenDetails.mockResolvedValue(fail("That username is already taken. You could use a, b or c.", { username: ["That username is already taken."] }));
    await user.type(username, "pixel_wren");
    await user.type(screen.getByLabelText(/^Password/), "meadow-kettle-comet-77");
    await user.type(screen.getByLabelText("Your parent or carer's email address"), "mum@example.test");
    await user.click(screen.getByRole("button", { name: "Create my account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already taken");
    // The birth month and year travel with the second step, and the server checks them again.
    expect(sent(0, actions.teenDetails)).toEqual({ birthMonth: "5", birthYear: "2012", username: "pixel_wren", password: "meadow-kettle-comet-77", parentEmail: "mum@example.test" });
    // Still on step two, with everything they typed.
    expect(screen.getByLabelText("Username")).toHaveValue("pixel_wren");
    expect(screen.getByLabelText("Your parent or carer's email address")).toHaveValue("mum@example.test");
    expect(screen.getByRole("button", { name: "Start again" })).toBeInTheDocument();
  });

  it("for an 18-year-old, asks for their own email and their own consents, none of them pre-ticked", async () => {
    actions.teenAge.mockResolvedValue({ ok: true, data: { route: "adult", birthMonth: 3, birthYear: 2007, suggestions: [] } });
    actions.adultDetails.mockResolvedValue({ ok: true, data: { sent: true } });
    const user = userEvent.setup();
    renderForm();
    await answerAge(user, "3", "2007");

    expect(await screen.findByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByLabelText(/parent or carer's email/i)).not.toBeInTheDocument();
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes).toHaveLength(4);
    for (const box of boxes) expect(box).not.toBeChecked();

    await user.type(screen.getByLabelText("Username"), "calm_falcon_301");
    await user.type(screen.getByLabelText("Email address"), "josh@example.test");
    await user.type(screen.getByLabelText(/^Password/), "meadow-kettle-comet-77");
    await user.click(screen.getByLabelText("I agree: Account and learning data"));
    await user.click(screen.getByRole("button", { name: "Create my account" }));

    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(sent(0, actions.adultDetails)).toMatchObject({
      birthMonth: "3",
      birthYear: "2007",
      username: "calm_falcon_301",
      email: "josh@example.test",
      consentKeys: "account_learning_data,ai_processing,third_party_tools,tutor_history_retention",
      "consent.account_learning_data": "on",
    });
    expect(sent(0, actions.adultDetails)).not.toHaveProperty("consent.ai_processing");
  });

  it("shows a problem with the birth date on the first step", async () => {
    actions.teenAge.mockResolvedValue(fail("Choose the month and the year of birth.", { birth: ["Choose a month and a year."] }));
    const user = userEvent.setup();
    renderForm();
    await answerAge(user, "5", "2012");
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the month and the year of birth.");
    expect(screen.getByRole("group", { name: "When were you born?" })).toHaveAccessibleDescription(/Choose a month and a year/);
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });
});

describe("ParentSignupForm", () => {
  it("asks an adult for their own email, an optional password and the 18+ declaration, then says to check their email", async () => {
    actions.signUpParent.mockResolvedValue({ ok: true, data: { sent: true } });
    const user = userEvent.setup();
    render(<ParentSignupForm />);
    expect(screen.getByLabelText(/I am 18 or over, and I am the parent or carer/)).toBeRequired();
    expect(screen.getByLabelText(/^Password/)).not.toBeRequired();
    await user.type(screen.getByLabelText("Email address"), "priya@example.test");
    await user.click(screen.getByLabelText(/I am 18 or over/));
    await user.click(screen.getByRole("button", { name: "Create family account" }));
    expect(await screen.findByText("Check your email")).toBeInTheDocument();
    expect(sent(0, actions.signUpParent)).toMatchObject({ email: "priya@example.test", confirmedAdult: "on", password: "" });
    expect(screen.queryByRole("button", { name: "Create family account" })).not.toBeInTheDocument();
  });
});

describe("AddChildForm", () => {
  const props = { maxYear: 2026, minYear: 1996, suggestions: ["brave_otter_482", "calm_fox_301", "sunny_wren_555"], full: { seats: 2 }, isFull: false };

  it("asks for a nickname, month and year, a username and an optional password: never a child's email, surname, school or photo", () => {
    render(<AddChildForm {...props} />);
    expect(screen.getByLabelText("Nickname")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "When were they born?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription(/Ideas: brave_otter_482, calm_fox_301, sunny_wren_555/);
    expect(screen.getByLabelText(/^Password/)).not.toBeRequired();
    for (const never of [/email/i, /surname|last name|full name/i, /school/i, /photo|picture/i, /address|postcode|town/i, /day/i]) {
      expect(screen.queryByLabelText(never)).not.toBeInTheDocument();
    }
    expect(document.querySelector('input[type="email"], input[type="file"]')).toBeNull();
  });

  it("shows the one-time code once, with the username and the way on to the permissions", async () => {
    actions.addChild.mockResolvedValue({ ok: true, data: { learnerId: "11111111-1111-4111-8111-111111111111", nickname: "Maya", username: "pixel_wren_77", invite: { code: "ABCD-EFGH", expiresOn: "19 November 2026 at 10:00" } } });
    const user = userEvent.setup();
    render(<AddChildForm {...props} />);
    await user.type(screen.getByLabelText("Nickname"), "Maya");
    await user.selectOptions(screen.getByLabelText("Month"), "5");
    await user.selectOptions(screen.getByLabelText("Year"), "2012");
    await user.type(screen.getByLabelText("Username"), "pixel_wren_77");
    await user.click(screen.getByRole("button", { name: "Add child" }));

    expect(await screen.findByTestId("invite-code")).toHaveTextContent("ABCD-EFGH");
    expect(screen.getByText(/19 November 2026 at 10:00/)).toBeInTheDocument();
    expect(screen.getByText("pixel_wren_77")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to Maya's permissions" })).toHaveAttribute("href", "/parent/children/11111111-1111-4111-8111-111111111111/consent?from=new");
    expect(sent(0, actions.addChild)).toEqual({ nickname: "Maya", birthMonth: "5", birthYear: "2012", username: "pixel_wren_77", password: "" });
  });

  it("still shows the code when adding that child filled the plan", async () => {
    actions.addChild.mockResolvedValue({ ok: true, data: { learnerId: "11111111-1111-4111-8111-111111111111", nickname: "Maya", username: "pixel_wren_77", invite: { code: "ABCD-EFGH", expiresOn: "soon" } } });
    const user = userEvent.setup();
    const { rerender } = render(<AddChildForm {...props} />);
    await user.type(screen.getByLabelText("Nickname"), "Maya");
    await user.selectOptions(screen.getByLabelText("Month"), "5");
    await user.selectOptions(screen.getByLabelText("Year"), "2012");
    await user.type(screen.getByLabelText("Username"), "pixel_wren_77");
    await user.click(screen.getByRole("button", { name: "Add child" }));
    await screen.findByTestId("invite-code");
    // The page re-renders after the action, and now the plan is full.
    rerender(<AddChildForm {...props} isFull />);
    expect(screen.getByTestId("invite-code")).toHaveTextContent("ABCD-EFGH");
  });

  it("says when every place on the plan is in use, without a price", () => {
    render(<AddChildForm {...props} isFull />);
    expect(screen.getByText("All the places on your plan are in use")).toBeInTheDocument();
    expect(screen.getByText(/room for 2 learners/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add child" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/£/);
  });

  it("keeps the nickname and username when the username is refused", async () => {
    actions.addChild.mockResolvedValue(fail("That username includes the nickname.", { username: ["That username includes the nickname."] }));
    const user = userEvent.setup();
    render(<AddChildForm {...props} />);
    await user.type(screen.getByLabelText("Nickname"), "Maya");
    await user.selectOptions(screen.getByLabelText("Month"), "5");
    await user.selectOptions(screen.getByLabelText("Year"), "2012");
    await user.type(screen.getByLabelText("Username"), "maya_makes");
    await user.click(screen.getByRole("button", { name: "Add child" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Nickname")).toHaveValue("Maya");
    expect(screen.getByLabelText("Username")).toHaveValue("maya_makes");
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Year")).toHaveValue("2012");
  });
});

describe("ConsentFields and ConsentForm", () => {
  it("groups needed and optional consents, shows the full wording and never pre-ticks a needed one", () => {
    render(<ConsentFields items={CONSENTS.map((c) => ({ ...c, defaultChecked: !c.required }))} fieldError={() => undefined} audience="parent" />);
    expect(screen.getByRole("heading", { name: "Needed for the account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your choice" })).toBeInTheDocument();
    expect(screen.getByText("First paragraph.")).toBeInTheDocument();
    expect(screen.getByText("Second paragraph.")).toBeInTheDocument();
    expect(screen.getByLabelText("I agree: Account and learning data")).not.toBeChecked();
    expect(screen.getByLabelText("Switch on: Keep Coach conversations for longer (optional)")).toBeChecked();
    expect(document.querySelector('input[name="consentKeys"]')).toHaveValue("account_learning_data,ai_processing,third_party_tools,tutor_history_retention");
  });

  it("flags wording that has changed and shows what currently stands", () => {
    render(<ConsentFields items={[{ ...CONSENTS[1]!, needsReconsent: true, decided: "Given for earlier wording on 1 November 2026" }]} fieldError={(name) => (name === "consent.ai_processing" ? "Needed to run the account." : undefined)} audience="parent" />);
    expect(screen.getByText(/updated this wording/)).toBeInTheDocument();
    expect(screen.getByText("Given for earlier wording on 1 November 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("I agree: Coach: our built-in AI helper")).toHaveAccessibleDescription(/Needed to run the account/);
  });

  const formProps = { learnerId: "11111111-1111-4111-8111-111111111111", nickname: "Maya", from: "" as const, items: CONSENTS.map((c) => ({ ...c, defaultChecked: false })) };

  it("for a new child there is no pause warning; saving posts every key shown and the ticks made", async () => {
    actions.saveConsents.mockResolvedValue({ ok: true, data: { status: "paused", activated: false, paused: false, missingRequired: ["third_party_tools"], changed: 2 } });
    const user = userEvent.setup();
    render(<ConsentForm {...formProps} accountInUse={false} />);
    expect(screen.queryByLabelText(/Yes, pause Maya's account/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("I agree: Account and learning data"));
    await user.click(screen.getByLabelText("I agree: Coach: our built-in AI helper"));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));

    expect(await screen.findByText("Saved, but the account is still locked")).toBeInTheDocument();
    expect(screen.getByText(/One needed permission is still to be given/)).toBeInTheDocument();
    expect(sent(0, actions.saveConsents)).toEqual({
      learnerId: formProps.learnerId,
      from: "",
      consentKeys: "account_learning_data,ai_processing,third_party_tools,tutor_history_retention",
      "consent.account_learning_data": "on",
      "consent.ai_processing": "on",
    });
    // Their ticks are still there for the next save.
    expect(screen.getByLabelText("I agree: Coach: our built-in AI helper")).toBeChecked();
  });

  it("says when the account becomes ready, and when it has been paused", async () => {
    actions.saveConsents.mockResolvedValueOnce({ ok: true, data: { status: "active", activated: true, paused: false, missingRequired: [], changed: 3 } }).mockResolvedValueOnce({ ok: true, data: { status: "paused", activated: false, paused: true, missingRequired: ["ai_processing"], changed: 1 } });
    const user = userEvent.setup();
    render(<ConsentForm {...formProps} accountInUse />);
    await user.click(screen.getByRole("button", { name: "Save permissions" }));
    expect(await screen.findByText("Maya's account is ready")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Yes, pause Maya's account"));
    await user.click(screen.getByRole("button", { name: "Save permissions" }));
    expect(await screen.findByText("Maya's account is now paused")).toBeInTheDocument();
    expect(sent(1, actions.saveConsents)).toMatchObject({ confirmPause: "on" });
  });

  it("for an account in use, explains that withdrawing a needed permission pauses it, and shows the refusal beside the tick box", async () => {
    actions.saveConsents.mockResolvedValue(fail("Withdrawing a required consent pauses the account and signs the learner out straight away.", { confirmPause: ["Tick this box to confirm that the account should be paused."] }));
    const user = userEvent.setup();
    render(<ConsentForm {...formProps} accountInUse />);
    expect(screen.getByText(/paused and they are signed out straight away/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save permissions" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Yes, pause Maya's account")).toHaveAccessibleDescription(/Tick this box to confirm/);
  });
});

describe("sign-in and join forms", () => {
  it("the learner form asks for a username and password only, and never an email", async () => {
    actions.signInLearner.mockResolvedValue(fail("That username and password don't match. Check both, then try again."));
    const user = userEvent.setup();
    render(<LearnerSignInForm next="/explore" />);
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(screen.getByLabelText("Username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    await user.type(screen.getByLabelText("Username"), "pixel_wren_77");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't sign you in");
    expect(alert).toHaveTextContent("don't match");
    expect(sent(0, actions.signInLearner)).toEqual({ next: "/explore", username: "pixel_wren_77", password: "wrong-password" });
    expect(screen.getByLabelText("Username")).toHaveValue("pixel_wren_77");
  });

  it("the parent form asks for an email address and allows password managers and paste", async () => {
    actions.signInEmail.mockResolvedValue(fail("x"));
    const user = userEvent.setup();
    render(<EmailSignInForm next="" />);
    const password = screen.getByLabelText("Password");
    expect(screen.getByLabelText("Email address")).toHaveAttribute("type", "email");
    expect(password).toHaveAttribute("autocomplete", "current-password");
    await user.click(password);
    await user.paste("pasted-from-a-manager");
    expect(password).toHaveValue("pasted-from-a-manager");
    await user.click(screen.getByRole("button", { name: /Show/ }));
    expect(password).toHaveAttribute("type", "text");
  });

  it("the join form takes a code, a username and a new password, with the code filled in from a link", async () => {
    actions.redeemInvite.mockResolvedValue(fail("That code and username don't match. Check both, then try again.", { code: ["Check the code and your username."] }));
    const user = userEvent.setup();
    render(<JoinForm code="ABCD-EFGH" />);
    expect(screen.getByRole("textbox", { name: "Your code" })).toHaveValue("ABCD-EFGH");
    expect(document.querySelector('input[type="email"]')).toBeNull();
    await user.type(screen.getByLabelText("Your username"), "pixel_wren_77");
    await user.type(screen.getByLabelText("Choose a password"), "meadow-kettle-comet-77");
    await user.click(screen.getByRole("button", { name: "Set my password and sign in" }));
    await screen.findByRole("alert");
    expect(sent(0, actions.redeemInvite)).toEqual({ code: "ABCD-EFGH", username: "pixel_wren_77", password: "meadow-kettle-comet-77" });
    expect(screen.getByRole("textbox", { name: "Your code" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("accessibility of the account forms (axe, WCAG 2.2 AA rules)", () => {
  // Page-level rules (one main landmark, a level-one heading) belong to the shells, which these fragments are rendered without.
  const fragment = { rules: { region: { enabled: false }, "landmark-one-main": { enabled: false }, "page-has-heading-one": { enabled: false } } };

  it("finds nothing wrong in each form, in its first state", async () => {
    const forms = [
      <TeenSignupForm key="teen" maxYear={2026} minYear={1996} consents={CONSENTS} copy={TEEN_COPY} />,
      <ParentSignupForm key="parent" />,
      <AddChildForm key="child" maxYear={2026} minYear={1996} suggestions={["brave_otter_482"]} full={{ seats: 2 }} isFull={false} />,
      <ConsentForm key="consent" learnerId="11111111-1111-4111-8111-111111111111" nickname="Maya" from="" accountInUse items={CONSENTS.map((c) => ({ ...c, defaultChecked: false, needsReconsent: c.key === "ai_processing" }))} />,
      <LearnerSignInForm key="learner" next="" />,
      <EmailSignInForm key="email" next="" />,
      <JoinForm key="join" />,
    ];
    for (const form of forms) {
      const { unmount, container } = render(<main><h1>Page</h1>{form}</main>);
      expect(await axeViolations(container, fragment), String(form.key)).toEqual([]);
      unmount();
    }
  });

  it("finds nothing wrong with errors showing", async () => {
    actions.signInLearner.mockResolvedValue(fail("That username and password don't match.", { password: ["Check your password."] }));
    const user = userEvent.setup();
    const { container } = render(<main><h1>Sign in</h1><LearnerSignInForm next="" /></main>);
    await user.type(screen.getByLabelText("Username"), "pixel_wren_77");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("alert");
    expect(await axeViolations(container, fragment)).toEqual([]);
  });
});
