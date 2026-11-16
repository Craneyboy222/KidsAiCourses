import "server-only";
import { notFound } from "next/navigation";
import { formatDate } from "@/lib/dates";
import { appErrorCode } from "@/lib/parents/error-code";
import type { ApprovalItem } from "@/server/services/approvals";
import type { ApprovalCardItem } from "../_components/approval-card";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs a page's loader. A child or request that is not in this parent's family, and one that does
 * not exist, both end in the ordinary "not found" page, so an id in an address confirms nothing.
 */
export async function loadOr404<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    const code = appErrorCode(error);
    if (code === "not_found" || code === "forbidden") notFound();
    throw error;
  }
}

/** The plain data the approval card needs: dates turned into words here, so the browser's clock and locale never matter. */
export function toCardItem(item: ApprovalItem): ApprovalCardItem {
  return {
    source: item.source,
    id: item.id,
    kind: item.kind,
    learnerNickname: item.learnerNickname,
    courseTitle: item.courseTitle,
    status: item.status,
    requestedOn: formatDate(item.requestedAt),
    tool: item.tool
      ? {
          name: item.tool.name,
          vendorDomain: item.tool.vendorDomain,
          officialUrl: item.tool.officialUrl,
          cost: item.tool.cost,
          freeTier: item.tool.freeTier,
          minAge: item.tool.minAge,
          consentRule: item.tool.consentRule,
          lastCheckedOn: item.tool.lastCheckedAt ? formatDate(item.tool.lastCheckedAt) : null,
          available: item.tool.available,
        }
      : null,
    guideHref: item.guideHref,
  };
}

/** "2 hr 5 min", or "None yet" for zero, so a quiet week does not read as an error. */
export function minutesLabel(minutes: number): string {
  if (minutes <= 0) return "None yet";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}
