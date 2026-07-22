import { describe, expect, it } from "vitest";
import { scoreCompany } from "./icpScorer.js";

const baseCompany = { name: "Acme", domain: "acme.com", platform: "meta" };

describe("ICP scorer", () => {
  it("accepts a target industry and geography", () => {
    expect(scoreCompany({ ...baseCompany, industry: "SaaS", geography: "US" }).match).toBe(true);
  });

  it("rejects a company outside target industries", () => {
    const score = scoreCompany({ ...baseCompany, industry: "Home Services", geography: "US" });
    expect(score.match).toBe(false);
    expect(score.reason).toContain("outside the current ICP");
  });

  it("rejects missing industry data with an explanation", () => {
    expect(scoreCompany(baseCompany)).toEqual({ match: false, reason: "Industry is missing" });
  });
});
