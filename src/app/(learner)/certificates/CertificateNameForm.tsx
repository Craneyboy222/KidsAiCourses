"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError, Input, RadioGroup, SubmitButton, useActionForm } from "@/components/ui";
import { setCertificateNameAction } from "./actions";

/** Nickname (the default) or first name on future certificates. Works without JavaScript: the first-name box is simply always there. */
export function CertificateNameForm({ choice, nickname, firstName }: { choice: "nickname" | "first_name"; nickname: string; firstName: string }) {
  const router = useRouter();
  const [picked, setPicked] = useState(choice);
  const form = useActionForm(setCertificateNameAction, { onSuccess: () => router.refresh() });
  return (
    <form action={form.formAction} className="flex flex-col gap-4">
      <FormError {...form.summaryProps} />
      <RadioGroup
        legend="Name on your certificates"
        hint="This is the only thing about you on a certificate. Anyone you give the certificate to can see it."
        name="choice"
        value={picked}
        onChange={(event) => setPicked(event.target.value === "first_name" ? "first_name" : "nickname")}
        options={[
          { value: "nickname", label: `My nickname: ${nickname}` },
          { value: "first_name", label: "My first name", description: "First name only, never a surname." },
        ]}
      />
      {picked === "first_name" && (
        <Field label="First name" error={form.fieldError("firstName")}>
          <Input name="firstName" defaultValue={firstName} maxLength={24} autoComplete="given-name" />
        </Field>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingText="Saving…">
          Save
        </SubmitButton>
        {form.succeeded && <span role="status">Saved. New certificates will use this name.</span>}
      </div>
    </form>
  );
}
