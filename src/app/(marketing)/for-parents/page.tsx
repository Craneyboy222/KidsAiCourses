import { permanentRedirect } from "next/navigation";

/**
 * The marketing brief calls this page `/for-parents`; the spec (Section 5) and the site's menu
 * call it `/parents`. There is one page, at `/parents`, and this address forwards to it.
 */
export default function ForParentsRedirect(): never {
  permanentRedirect("/parents");
}
