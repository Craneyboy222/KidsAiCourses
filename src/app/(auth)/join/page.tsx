import type { Metadata } from "next";
import { JoinForm } from "./join-form";
import { JoinShell } from "./join-shell";

export const metadata: Metadata = { title: "Use your code" };

export default function JoinPage() {
  return (
    <JoinShell>
      <JoinForm />
    </JoinShell>
  );
}
