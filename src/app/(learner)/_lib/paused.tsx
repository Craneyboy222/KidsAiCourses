import { EmptyState, LinkButton } from "@/components/ui";

/**
 * Shown in place of a learner page while the account is not active. The reason is in the notice
 * above (from the layout); this just makes sure the page is not an empty frame.
 */
export function AccountOnHold({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
      <EmptyState
        title="This is on hold for now"
        description="Everything you've made and saved is safe. A parent or carer can switch your account back on from their dashboard."
        action={
          <LinkButton href="/settings" variant="secondary">
            Go to settings
          </LinkButton>
        }
      />
    </div>
  );
}
