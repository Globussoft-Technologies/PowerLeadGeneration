import type { RunFilters } from "@power-leads/shared";
import { env } from "../config/env.js";
import pRetry, { AbortError } from "p-retry";
import { z } from "zod";

export type RawAdvertiser = {
  company_name: string;
  domain: string;
  platform: string;
  ad_creative_snippet?: string;
  ad_first_seen?: string;
  ad_last_seen?: string;
  days_active?: number;
  ad_url?: string;
  industry?: string;
  geography?: string;
  category?: string;
};

const rawAdvertiserSchema = z.object({
  company_name: nullableString(""),
  domain: nullableString(""),
  platform: nullableString(""),
  ad_creative_snippet: optionalNullableString(20_000),
  ad_first_seen: optionalNullableString(),
  ad_last_seen: optionalNullableString(),
  days_active: z.preprocess((value) => value === null || value === "" ? undefined : value, z.coerce.number().int().min(0).optional()),
  ad_url: optionalNullableString(),
  industry: optionalNullableString(500),
  geography: optionalNullableString(5_000),
  category: optionalNullableString(500)
}).passthrough();

const adsApiResponseSchema = z.object({
  code: z.number(),
  page: z.number().int().min(1),
  page_size: z.number().int().min(1).max(100),
  total_results: z.number().int().min(0),
  results: z.array(rawAdvertiserSchema),
  message: z.string().optional()
});

export type DiscoveredCompany = {
  name: string;
  domain: string;
  platform: string;
  adCreativeSnippet?: string;
  adFirstSeen?: Date;
  adLastSeen?: Date;
  daysActive?: number;
  adUrl?: string;
  industry?: string;
  geography?: string;
  category?: string;
};

export interface AdsClient {
  fetchAll(filters: RunFilters, beforeRequest?: () => Promise<void>): Promise<DiscoveredCompany[]>;
}

export function buildAdsRequestBody(filters: RunFilters, page: number) {
  return {
    keyword: filters.keyword ?? "",
    industry: filters.industry ?? "",
    category: filters.category ?? "",
    geography: filters.geography ?? "",
    platform: filters.platform,
    min_days_active: filters.minDaysActive,
    page,
    page_size: filters.pageSize
  };
}

export function normalizeDomain(value: string) {
  const candidate = value.trim().toLowerCase();
  if (!candidate) return "";

  try {
    const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return candidate.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

export function normalizePlatform(value: string) {
  const platform = value.trim().toLowerCase();
  return platform === "facebook" ? "meta" : platform;
}

export function mapAdvertiser(raw: RawAdvertiser): DiscoveredCompany | null {
  const domain = normalizeDomain(raw.domain ?? "");
  const name = raw.company_name?.trim();
  if (!domain || !name) return null;

  return {
    name,
    domain,
    platform: normalizePlatform(raw.platform),
    adCreativeSnippet: raw.ad_creative_snippet,
    adFirstSeen: validDate(raw.ad_first_seen),
    adLastSeen: validDate(raw.ad_last_seen),
    daysActive: raw.days_active,
    adUrl: raw.ad_url,
    industry: raw.industry,
    geography: raw.geography,
    category: raw.category
  };
}

export function applyAdsFilters(companies: DiscoveredCompany[], filters: RunFilters) {
  return companies.map((company) => ({
      ...company,
      // The Ads API sometimes returns its parent category in both fields even
      // when it accepted an exact subcategory filter. The selected catalog
      // values are therefore the canonical classification for this run.
      category: filters.category || company.category?.trim() || undefined,
      industry: filters.industry || company.industry?.trim() || undefined,
      geography: company.geography?.trim() || filters.geography || undefined
    }));
}

class LiveAdsClient implements AdsClient {
  async fetchAll(filters: RunFilters, beforeRequest?: () => Promise<void>) {
    const companies: DiscoveredCompany[] = [];

    for (let page = 1; page <= env.ADS_API_MAX_PAGES; page += 1) {
      const payload = await pRetry(async () => {
        await beforeRequest?.();
        const response = await fetch(env.ADS_API_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${env.ADS_API_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify(buildAdsRequestBody(filters, page)),
          signal: AbortSignal.timeout(20_000)
        });
        if (!response.ok) {
          const message = `Ads API request failed (${response.status})`;
          if (response.status !== 429 && response.status < 500) throw new AbortError(message);
          throw new Error(message);
        }
        return parseAdsResponse(await response.json());
      }, {
        retries: 2,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 3_000,
        shouldRetry: (error) => !(error instanceof z.ZodError)
      });
      if (payload.code !== 200) throw new Error(payload.message || `Ads API returned code ${payload.code}`);

      companies.push(...payload.results.map(mapAdvertiser).filter(isCompany));
      if (payload.results.length < filters.pageSize || companies.length >= payload.total_results) break;
    }

    return applyAdsFilters(companies, filters);
  }
}

export function parseAdsResponse(value: unknown) {
  return adsApiResponseSchema.parse(value);
}

function validDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nullableString(fallback: string) {
  return z.string().nullish().transform((value) => value ?? fallback);
}

function optionalNullableString(max = 10_000) {
  return z.string().max(max).nullish().transform((value) => value ?? undefined);
}

const MOCK_ADVERTISERS: RawAdvertiser[] = [
  {
    company_name: "Northstar CRM",
    domain: "northstar.example",
    platform: "meta",
    ad_creative_snippet: "Bring your revenue team into one intelligent workspace.",
    ad_first_seen: "2026-04-01",
    ad_last_seen: "2026-07-20",
    days_active: 110,
    ad_url: "https://northstar.example/crm",
    geography: "US",
    category: "Computer Software",
    industry: "Enterprise Computer Software"
  },
  {
    company_name: "Juniper Commerce",
    domain: "www.juniper-commerce.example",
    platform: "facebook",
    ad_creative_snippet: "A faster storefront for growing retail brands.",
    ad_first_seen: "2026-05-01",
    ad_last_seen: "2026-07-20",
    days_active: 80,
    ad_url: "https://juniper-commerce.example/summer",
    industry: "eCommerce",
    geography: "US, Canada",
    category: "Retail"
  },
  {
    company_name: "Local Home Repair",
    domain: "local-repair.example",
    platform: "meta",
    ad_creative_snippet: "Same-day plumbing repair.",
    ad_first_seen: "2026-07-15",
    ad_last_seen: "2026-07-20",
    days_active: 5,
    ad_url: "https://local-repair.example",
    industry: "Home Improvement and Repair",
    geography: "US",
    category: "Home and Garden Services"
  }
];

class MockAdsClient implements AdsClient {
  async fetchAll(filters: RunFilters, beforeRequest?: () => Promise<void>) {
    await beforeRequest?.();
    const companies = MOCK_ADVERTISERS.map(mapAdvertiser).filter(isCompany);
    return applyAdsFilters(companies, filters);
  }
}

function isCompany(company: DiscoveredCompany | null): company is DiscoveredCompany {
  return company !== null;
}

export function createAdsClient(): AdsClient {
  return env.ADS_API_MODE === "live" ? new LiveAdsClient() : new MockAdsClient();
}
