"use client";

import { Button } from "@/components/ui/button";

/** Loads the page the visitor was trying to reach again. Used on the offline page. */
export function ReloadButton() {
  return <Button onClick={() => window.location.reload()}>Try again</Button>;
}
