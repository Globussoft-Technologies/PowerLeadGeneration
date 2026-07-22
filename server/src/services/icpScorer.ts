import type { DiscoveredCompany } from "../integrations/adsApi.js";

const DEFAULT_INDUSTRIES = ["saas", "b2b saas", "e-commerce", "ecommerce"];
const DEFAULT_GEOGRAPHIES = ["us", "united states", "uk", "united kingdom", "canada", "ca"];

export type IcpScore = { match: boolean; reason: string };
export type IcpCriteria = { industries: string[]; geographies: string[]; exclusions: string[] };

export function scoreCompany(company: DiscoveredCompany, criteria?: IcpCriteria): IcpScore {
  const industries = criteria?.industries.map(normalize) ?? DEFAULT_INDUSTRIES;
  const targetGeographies = criteria?.geographies.map(normalize) ?? DEFAULT_GEOGRAPHIES;
  const exclusions = criteria?.exclusions.map(normalize) ?? [];
  const industry = company.industry?.trim().toLowerCase();
  if (!industry) return { match: false, reason: "Industry is missing" };
  if (exclusions.some((exclusion) => company.name.toLowerCase().includes(exclusion) || company.domain.includes(exclusion))) {
    return { match: false, reason: "Company matches an ICP exclusion" };
  }
  if (!industries.includes(industry)) {
    return { match: false, reason: `Industry '${company.industry}' is outside the current ICP` };
  }

  const geographies = company.geography
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean) ?? [];

  if (geographies.length > 0 && !geographies.some((value) => targetGeographies.includes(value))) {
    return { match: false, reason: `Geography '${company.geography}' is outside the current ICP` };
  }

  return { match: true, reason: `Matches the current ${company.industry} and geography criteria` };
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
