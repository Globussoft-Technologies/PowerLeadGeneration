import type { RunStatus } from "@power-leads/shared";

export function completionForReview(reviewRequired: boolean, enriched: number): {
  status: RunStatus;
  approved: number;
  autoApprove: boolean;
} {
  return reviewRequired && enriched > 0
    ? { status: "pending_review", approved: 0, autoApprove: false }
    : { status: "done", approved: enriched, autoApprove: true };
}
