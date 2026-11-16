"use client";

import { useRouter } from "next/navigation";
import { askToolApprovalAction, decideToolApprovalAction, revokeToolApprovalAction } from "@/app/_tools/actions";
import { Checkbox, FormError, SubmitButton, useActionForm } from "@/components/ui";

/** The small forms inside "Tools you'll need". Each works without JavaScript; with it, the page refreshes itself afterwards. */

export function AskParentForTool({ courseId, toolSlug, toolName, parentSetsUp }: { courseId: string; toolSlug: string; toolName: string; parentSetsUp: boolean }) {
  const router = useRouter();
  const form = useActionForm(askToolApprovalAction, { onSuccess: () => router.refresh() });
  if (form.succeeded) {
    return (
      <p role="status" className="font-bold">
        Request sent. We&apos;ve asked your parent or carer about {toolName}.
      </p>
    );
  }
  return (
    <form action={form.formAction} className="flex flex-col items-start gap-2">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="toolSlug" value={toolSlug} />
      <SubmitButton size="sm" pendingText="Sending your request…">
        {parentSetsUp ? `Ask a parent to set up ${toolName}` : `Ask a parent about ${toolName}`}
      </SubmitButton>
    </form>
  );
}

export function ParentToolDecision({ learnerId, courseId, toolSlug, toolName, childName, parentSetsUp, declined }: { learnerId: string; courseId: string; toolSlug: string; toolName: string; childName: string; parentSetsUp: boolean; declined: boolean }) {
  const router = useRouter();
  const form = useActionForm(decideToolApprovalAction, { onSuccess: () => router.refresh() });
  return (
    <form action={form.formAction} className="flex flex-col gap-3">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="learnerId" value={learnerId} />
      <input type="hidden" name="courseId" value={courseId} />
      <input type="hidden" name="toolSlug" value={toolSlug} />
      {parentSetsUp && (
        <Checkbox
          name="parentWillOperate"
          label={`I will set up the ${toolName} account myself and stay in charge of it`}
          description={`${toolName} does not allow accounts for under-18s. The account is yours: ${childName} uses it with you, and never needs your password.`}
          error={form.fieldError("parentWillOperate")}
        />
      )}
      <div className="flex flex-wrap gap-3">
        <SubmitButton size="sm" name="decision" value="approve" pendingText="Saving…">
          Approve {toolName} for {childName}
        </SubmitButton>
        {!declined && (
          <SubmitButton size="sm" variant="secondary" name="decision" value="decline" pendingText="Saving…">
            Decline
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

export function ParentToolRevoke({ approvalId, toolName }: { approvalId: string; toolName: string }) {
  const router = useRouter();
  const form = useActionForm(revokeToolApprovalAction, { onSuccess: () => router.refresh() });
  return (
    <form action={form.formAction} className="flex flex-col items-start gap-2">
      <FormError {...form.summaryProps} />
      <input type="hidden" name="approvalId" value={approvalId} />
      <SubmitButton size="sm" variant="secondary" pendingText="Saving…">
        Remove approval for {toolName}
      </SubmitButton>
    </form>
  );
}
