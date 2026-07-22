import { describe, expect, it } from "vitest";
import { createGeminiClient, normalizeAnalysis } from "./gemini.js";

describe("Gemini analysis", () => {
  it("normalizes classification to exact catalog and ICP titles", () => {
    const result = normalizeAnalysis({
      category: "computer software",
      industry: "enterprise computer software",
      icpMatch: true,
      icpScore: 91,
      icpReason: "Strong software fit",
      personalization: "Your campaign shows active demand."
    }, {
      icp: { industries: ["Enterprise Computer Software"], geographies: ["India"], exclusions: [] },
      selectedCategory: "",
      selectedIndustry: ""
    });

    expect(result.category).toBe("Computer Software");
    expect(result.industry).toBe("Enterprise Computer Software");
  });

  it("keeps selected run classifications canonical", () => {
    const result = normalizeAnalysis({
      category: "Retail",
      industry: "eCommerce",
      icpMatch: true,
      icpScore: 80,
      icpReason: "Fit",
      personalization: "Relevant campaign."
    }, {
      icp: { industries: ["Business Services"], geographies: ["US"], exclusions: [] },
      selectedCategory: "Business and Industrial",
      selectedIndustry: "Business Services"
    });

    expect(result).toMatchObject({ category: "Business and Industrial", industry: "Business Services" });
  });

  it("scores the selected run classification in mock/fallback mode", async () => {
    const result = await createGeminiClient("mock").analyzeCompany({
      name: "Acme",
      domain: "acme.com",
      platform: "meta",
      industry: "Parent label"
    }, {
      icp: { industries: ["Business Services"], geographies: ["US"], exclusions: [] },
      selectedCategory: "Business and Industrial",
      selectedIndustry: "Business Services"
    });

    expect(result).toMatchObject({ industry: "Business Services", icpMatch: true, icpScore: 85 });
    expect(result).toMatchObject({ source: "mock", promptVersion: "company-analysis-v1", model: "mock" });
  });
});
