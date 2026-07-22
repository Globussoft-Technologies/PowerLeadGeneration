import { env } from "../config/env.js";
import { SettingsModel } from "../models/settings.js";

const DEFAULT_SETTINGS = {
  key: "default" as const,
  icp: {
    industries: ["Enterprise Computer Software", "eCommerce"],
    geographies: ["US", "United States", "UK", "United Kingdom", "Canada", "CA"],
    exclusions: [] as string[]
  },
  personas: {
    titles: ["CMO", "VP Marketing", "Head of Growth", "Director of Demand Generation"],
    seniorities: ["c_suite", "vp", "head", "director"],
    requireVerifiedEmail: env.APOLLO_REQUIRE_VERIFIED_EMAIL
  }
};

export async function getSettings(workspaceId: string, updatedBy = "system") {
  return SettingsModel.findOneAndUpdate(
    { workspaceId, key: "default" },
    { $setOnInsert: { ...DEFAULT_SETTINGS, workspaceId, updatedBy } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}
