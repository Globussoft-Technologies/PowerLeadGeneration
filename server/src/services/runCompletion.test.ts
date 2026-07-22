import { describe, expect, it } from "vitest";
import { completionForReview } from "./runCompletion.js";

describe("run completion", () => {
  it("pauses runs that require review", () => {
    expect(completionForReview(true, 3)).toEqual({ status: "pending_review", approved: 0, autoApprove: false });
  });

  it("completes when review is enabled but no contacts were found", () => {
    expect(completionForReview(true, 0)).toEqual({ status: "done", approved: 0, autoApprove: true });
  });

  it("auto-approves and completes runs that bypass review", () => {
    expect(completionForReview(false, 3)).toEqual({ status: "done", approved: 3, autoApprove: true });
  });
});
