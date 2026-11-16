import Link from "next/link";

/** The small print under every auth page: where to get help and how we use data. */
export function AuthFinePrint() {
  return (
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      <Link href="/help" className="link">
        Help
      </Link>
      <Link href="/safety" className="link">
        How we keep it safe
      </Link>
      <Link href="/legal/privacy" className="link">
        Privacy
      </Link>
      <Link href="/legal/privacy-teen" className="link">
        Privacy for teens
      </Link>
    </p>
  );
}
