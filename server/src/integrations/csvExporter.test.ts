import { describe, expect, it } from "vitest";
import { exportContactsCsv, type CsvContactRow } from "./csvExporter.js";

const baseRow: CsvContactRow = {
  company_name: "Acme",
  company_domain: "acme.com",
  company_category: "Business and Industrial",
  company_industry: "Business Services",
  contact_name: "Morgan Lee",
  title: "CMO",
  email: "morgan@acme.com",
  email_verified: true,
  personal_emails: "morgan@example.com",
  phone_numbers: "+15551234567 (mobile/valid_number)",
  mobile_numbers: "+15551234567",
  linkedin_url: "https://linkedin.com/in/morgan",
  twitter_url: "https://twitter.com/morgan",
  facebook_url: undefined,
  github_url: "https://github.com/morgan",
  seniority: "c_suite",
  ad_platform: "meta",
  ad_seen_date: "2026-07-20",
  ad_creative_snippet: "Build faster",
  personalized_hook: "Your campaign caught my attention.",
  source: "power_leads"
};

describe("CSV exporter", () => {
  it("adds a stable header and UTF-8 BOM", () => {
    const csv = exportContactsCsv([baseRow]);
    expect(csv.startsWith("\uFEFFcompany_name,company_domain,company_category,company_industry")).toBe(true);
    expect(csv).toContain("Acme,acme.com,Business and Industrial,Business Services,Morgan Lee");
  });

  it("escapes commas, quotes, and newlines", () => {
    const csv = exportContactsCsv([{ ...baseRow, company_name: 'Acme, "Global"', ad_creative_snippet: "Line one\nLine two" }]);
    expect(csv).toContain('"Acme, ""Global"""');
    expect(csv).toContain('"Line one\nLine two"');
  });

  it("exports only the rows supplied by the approval query", () => {
    expect(exportContactsCsv([]).split("\r\n")).toHaveLength(2);
  });
});
