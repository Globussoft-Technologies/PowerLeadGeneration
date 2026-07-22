import { describe, expect, it } from "vitest";
import { applyAdsFilters, buildAdsRequestBody, mapAdvertiser, normalizeDomain, normalizePlatform, parseAdsResponse } from "./adsApi.js";

describe("Ads API mapping", () => {
  it("normalizes domains and platform names", () => {
    expect(normalizeDomain("https://www.Acme.com/landing")).toBe("acme.com");
    expect(normalizePlatform("Facebook")).toBe("meta");
  });

  it("maps the external payload into a discovered company", () => {
    const company = mapAdvertiser({
      company_name: " Acme ",
      domain: "www.acme.com",
      platform: "facebook",
      days_active: 42,
      ad_first_seen: "2026-06-01",
      industry: "SaaS"
    });

    expect(company).toMatchObject({
      name: "Acme",
      domain: "acme.com",
      platform: "meta",
      daysActive: 42,
      industry: "SaaS"
    });
  });

  it("drops records without the required domain", () => {
    expect(mapAdvertiser({ company_name: "Acme", domain: "", platform: "meta" })).toBeNull();
  });

  it("preserves selected category and industry titles in the request body", () => {
    const body = buildAdsRequestBody({
      keyword: "",
      category: "Business and Industrial",
      industry: "Advertising and Marketing",
      geography: "",
      platform: "facebook",
      minDaysActive: 100,
      pageSize: 100
    }, 1);
    expect(body.category).toBe("Business and Industrial");
    expect(body.industry).toBe("Advertising and Marketing");
    expect(body.page_size).toBe(100);
  });

  it("trusts API filtering while using the selected catalog classification", () => {
    const filters = {
      keyword: "acme",
      category: "Business and Industrial",
      industry: "Business Services",
      geography: "US",
      platform: "facebook",
      minDaysActive: 30,
      pageSize: 100
    };
    const companies = [
      { name: "Acme", domain: "acme.com", platform: "meta", daysActive: 45 },
      { name: "Acme Too New", domain: "new.acme.com", platform: "meta", daysActive: 1 },
      { name: "Acme Parent Label", domain: "parent.acme.com", platform: "meta", daysActive: 45, category: "Business and Industrial", industry: "Business and Industrial" }
    ];

    expect(applyAdsFilters(companies, filters)).toEqual([
      expect.objectContaining({
        name: "Acme",
        category: "Business and Industrial",
        industry: "Business Services",
        geography: "US"
      }),
      expect.objectContaining({
        name: "Acme Too New",
        daysActive: 1,
        category: "Business and Industrial",
        industry: "Business Services"
      }),
      expect.objectContaining({
        name: "Acme Parent Label",
        category: "Business and Industrial",
        industry: "Business Services",
        geography: "US"
      })
    ]);
  });

  it("preserves Ads classifications when category filters are blank", () => {
    const companies = [{
      name: "Acme",
      domain: "acme.com",
      platform: "meta",
      daysActive: 45,
      category: "Business and Industrial",
      industry: "Business Services"
    }];

    expect(applyAdsFilters(companies, {
      keyword: "",
      category: "",
      industry: "",
      geography: "",
      platform: "facebook",
      minDaysActive: 30,
      pageSize: 100
    })).toEqual([expect.objectContaining({
      category: "Business and Industrial",
      industry: "Business Services"
    })]);
  });

  it("rejects malformed Ads response contracts", () => {
    expect(() => parseAdsResponse({ code: 200, page: 1, page_size: 100, total_results: -1, results: [] })).toThrow();
    expect(() => parseAdsResponse({ code: 200, page: 1, page_size: 100, total_results: 1, results: "invalid" })).toThrow();
  });

  it("accepts null optional fields and normalizes them as missing", () => {
    const payload = parseAdsResponse({
      code: 200,
      page: 1,
      page_size: 100,
      total_results: 1,
      results: [{ company_name: "Acme", domain: "acme.example", platform: "meta", industry: null, category: null, geography: null, days_active: null }]
    });
    expect(payload.results[0]).toMatchObject({ company_name: "Acme", domain: "acme.example", platform: "meta" });
    expect(payload.results[0]?.industry).toBeUndefined();
    expect(payload.results[0]?.category).toBeUndefined();
    expect(payload.results[0]?.days_active).toBeUndefined();
  });
});
