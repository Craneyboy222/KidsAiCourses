"use client";

import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { Button } from "./button";
import { buttonStyles } from "./button-styles";
import { cx } from "./cn";
import { Dialog } from "./dialog";

export type ExternalToolLinkProps = {
  /** The tool's address. Only http and https are ever linked. */
  href: string;
  /** The tool's display name from the Tool Register, for example "Canva". */
  toolName: string;
  /** Whether the Tool Register allows this learner to open this tool. When false, no link is rendered at all. */
  allowed: boolean;
  /** Link text. Defaults to "Open {toolName}". */
  children?: ReactNode;
  /** `link` sits in a sentence; `button` is a stand-alone action. */
  appearance?: "link" | "button";
  className?: string;
};

function isWebUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The only way to link to an external tool. It shows a "You're leaving…" notice
 * first, then opens the tool in a new tab with `rel="noopener noreferrer"`, so
 * the learner's place in the course is kept. When `allowed` is false (or the
 * address is not a web address) it renders plain text and no link.
 */
export function ExternalToolLink({
  href,
  toolName,
  allowed,
  children,
  appearance = "link",
  className,
}: ExternalToolLinkProps) {
  const [open, setOpen] = useState(false);
  const text = children ?? `Open ${toolName}`;

  if (!allowed || !isWebUrl(href)) {
    return <span className={className}>{children ?? toolName}</span>;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="sm"
      title={`You're leaving ${BRAND_NAME} to go to ${toolName}`}
      description={`${toolName} is a separate site with its own rules. It opens in a new tab, so your place here is saved.`}
      trigger={
        <button
          type="button"
          className={
            appearance === "button"
              ? buttonStyles({ variant: "secondary", className })
              : cx("link inline-flex items-center gap-1 text-start", className)
          }
        >
          {text}
          <ExternalLink aria-hidden="true" className="size-[1em] shrink-0" strokeWidth={2.5} />
        </button>
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Stay here
          </Button>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            data-button=""
            className={buttonStyles({ variant: "primary" })}
            onClick={() => setOpen(false)}
          >
            Continue to {toolName}
            <ExternalLink aria-hidden="true" className="size-5 shrink-0" strokeWidth={2.5} />{" "}
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </>
      }
    >
      <p>Keep your passwords to yourself: we will never ask for your {toolName} password or sign-in codes.</p>
    </Dialog>
  );
}
