import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Field, Input, MonthYearPicker, PasswordInput, RadioGroup, Select, Textarea } from "@/components/ui";

describe("Field", () => {
  it("ties the label to the input", () => {
    render(
      <Field label="Nickname">
        <Input name="nickname" />
      </Field>,
    );
    const input = screen.getByLabelText("Nickname");
    expect(input).toHaveAttribute("name", "nickname");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("describes the input with the hint and the error, and marks it invalid", () => {
    render(
      <Field
        label="Username"
        hint="Letters and numbers only."
        error={["That username is taken. Try adding a number.", "Second message"]}
      >
        <Input name="username" />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Username" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(
      "Letters and numbers only. Error: That username is taken. Try adding a number.",
    );

    // Every id in aria-describedby points at a real element.
    for (const id of (input.getAttribute("aria-describedby") ?? "").split(" ")) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    // Only the first message for a field is shown.
    expect(screen.queryByText("Second message")).not.toBeInTheDocument();
  });

  it("keeps an id and a description the control already had", () => {
    render(
      <>
        <p id="extra">Extra help</p>
        <Field label="Email" hint="We only use this to sign you in.">
          <Input id="email" name="email" type="email" aria-describedby="extra" />
        </Field>
      </>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAccessibleDescription("Extra help We only use this to sign you in.");
  });

  it("marks optional fields in the label and can hide the label visually", () => {
    render(
      <Field label="Search" optional hideLabel>
        <Input name="q" type="search" />
      </Field>,
    );
    expect(screen.getByRole("searchbox", { name: "Search (optional)" })).toBeInTheDocument();
  });

  it("wires Textarea and Select the same way", () => {
    render(
      <>
        <Field label="Notes" error="Add a note.">
          <Textarea name="notes" />
        </Field>
        <Field label="Year" hint="Your school year.">
          <Select name="year" placeholder="Choose a year" options={[{ value: "9", label: "Year 9" }]} />
        </Field>
      </>,
    );
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveAccessibleDescription("Error: Add a note.");
    const select = screen.getByRole("combobox", { name: "Year" });
    expect(select).toHaveAccessibleDescription("Your school year.");
    expect(select).toHaveDisplayValue("Choose a year");
  });
});

describe("PasswordInput", () => {
  it("is labelled by Field, allows password managers and paste, and can show the password", async () => {
    const user = userEvent.setup();
    render(
      <Field label="Password" error="Enter your password.">
        <PasswordInput name="password" />
      </Field>,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).not.toHaveAttribute("readonly");

    input.focus();
    await user.paste("correct horse battery staple");
    expect(input).toHaveValue("correct horse battery staple");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
    expect(input).toHaveValue("correct horse battery staple");
  });
});

describe("grouped controls", () => {
  it("RadioGroup names the group with its legend and describes it with hint and error", () => {
    render(
      <RadioGroup
        legend="Theme"
        name="theme"
        hint="Pick one."
        error="Choose a theme."
        options={[
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
      />,
    );
    const group = screen.getByRole("group", { name: "Theme" });
    expect(group).toHaveAccessibleDescription("Pick one. Error: Choose a theme.");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByLabelText("Dark")).toHaveAttribute("name", "theme");
  });

  it("MonthYearPicker renders two labelled selects that post month and year", () => {
    render(
      <MonthYearPicker
        legend="When were you born?"
        name="dob"
        minYear={2008}
        maxYear={2013}
        error="Choose the year you were born."
      />,
    );
    expect(screen.getByRole("group", { name: "When were you born?" })).toHaveAccessibleDescription(
      "Error: Choose the year you were born.",
    );
    const month = screen.getByRole("combobox", { name: "Month" });
    const year = screen.getByRole("combobox", { name: "Year" });
    expect(month).toHaveAttribute("name", "dobMonth");
    expect(year).toHaveAttribute("name", "dobYear");
    // Placeholder plus 12 months; placeholder plus 2013 down to 2008.
    expect(month.querySelectorAll("option")).toHaveLength(13);
    expect([...year.querySelectorAll("option")].map((o) => o.textContent)).toEqual([
      "Choose a year",
      "2013",
      "2012",
      "2011",
      "2010",
      "2009",
      "2008",
    ]);
  });
});
