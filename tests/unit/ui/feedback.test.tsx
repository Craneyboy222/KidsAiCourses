import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  Field,
  FormError,
  Input,
  ReportButton,
  SubmitButton,
  Toaster,
  dismissToast,
  toast,
  useActionForm,
  type ActionState,
} from "@/components/ui";

describe("Toaster", () => {
  const ids: number[] = [];
  afterEach(() => act(() => ids.splice(0).forEach(dismissToast)));

  it("shows a toast and announces it politely; errors are announced assertively and stay until dismissed", async () => {
    render(<Toaster />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    act(() => {
      ids.push(toast({ title: "Draft saved", tone: "success" }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Success: Draft saved");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();

    act(() => {
      ids.push(
        toast({
          title: "Upload failed",
          description: "Check your connection and try again.",
          tone: "danger",
        }),
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Error: Upload failed. Check your connection and try again.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Dismiss: Upload failed" }));
    expect(screen.queryByText("Check your connection and try again.")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Notifications" })).toHaveTextContent("Draft saved");
  });
});

describe("useActionForm", () => {
  function Form({
    action,
  }: {
    action: (prev: ActionState<{ id: string }>, formData: FormData) => Promise<ActionState<{ id: string }>>;
  }) {
    const form = useActionForm(action);
    return (
      <form action={form.formAction}>
        <FormError {...form.summaryProps} />
        <Field label="Nickname" error={form.fieldError("nickname")}>
          <Input name="nickname" />
        </Field>
        <SubmitButton>Save</SubmitButton>
        {form.succeeded && <p>Saved {form.data?.id}</p>}
      </form>
    );
  }

  it("shows the action's error, wires the field error and moves focus to the summary", async () => {
    const user = userEvent.setup();
    render(
      <Form
        action={async (_prev, formData) =>
          formData.get("nickname")
            ? { ok: true, data: { id: "n1" } }
            : {
                ok: false,
                error: {
                  code: "invalid_input",
                  message: "Some of that didn't look right.",
                  fieldErrors: { nickname: ["Choose a nickname."] },
                },
              }
        }
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Some of that didn't look right.");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(screen.getByLabelText("Nickname")).toHaveAccessibleDescription("Error: Choose a nickname.");

    await user.type(screen.getByLabelText("Nickname"), "pixel-fox");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved n1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ReportButton", () => {
  const reasons = [
    { value: "danger", label: "Someone is in danger", urgent: true },
    { value: "wrong", label: "It's wrong or doesn't make sense" },
  ];

  it("needs a reason, shows urgent help for danger, and sends the report", async () => {
    const user = userEvent.setup();
    const sent: unknown[] = [];
    render(
      <ReportButton reasons={reasons} subject="this step" onSubmit={(report) => void sent.push(report)} />,
    );

    await user.click(screen.getByRole("button", { name: "Report" }));
    expect(screen.getByRole("dialog", { name: "Report this step" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect(sent).toEqual([]);
    expect(screen.getByRole("group", { name: "What's the problem?" })).toHaveAccessibleDescription(
      "Error: Choose the reason that fits best.",
    );

    await user.click(screen.getByRole("radio", { name: "Someone is in danger" }));
    expect(screen.getByRole("alert")).toHaveTextContent("call 999");

    await user.type(
      screen.getByRole("textbox", { name: /Anything else/ }),
      "  The chat said something scary  ",
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("dialog", { name: "Report sent" })).toBeInTheDocument();
    expect(sent).toEqual([{ reason: "danger", details: "The chat said something scary" }]);
  });
});
