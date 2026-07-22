import type { RunFilters, RunStats } from "@power-leads/shared";
import pLimit from "p-limit";
import { env } from "../config/env.js";
import type { AdsClient, DiscoveredCompany } from "../integrations/adsApi.js";
import type { ApolloClient } from "../integrations/apollo.js";
import type { GeminiClient } from "../integrations/gemini.js";
import { CompanyModel } from "../models/company.js";
import { ContactModel } from "../models/contact.js";
import { RunModel, type PipelineStage, type RunDocumentShape } from "../models/run.js";
import { scoreCompany } from "../services/icpScorer.js";
import { getSettings } from "../services/settings.js";
import { completionForReview } from "../services/runCompletion.js";
import {
  beginStageMetric,
  completeStageMetric,
  defaultRunBudgets,
  ensureRunTelemetry,
  recordAdsResults,
  recordApolloContact,
  recordGeminiResult,
  reserveProviderCall
} from "../services/runUsage.js";

const ZERO_STATS: RunStats = {
  adsReturned: 0,
  discovered: 0,
  qualified: 0,
  enriched: 0,
  approved: 0,
  sent: 0,
  enrolled: 0,
  skipped: 0
};

export class PipelineCancelledError extends Error {
  constructor() { super("Pipeline cancellation requested"); }
}

export class PipelineLeaseLostError extends Error {
  constructor() { super("Pipeline worker lease was lost"); }
}

type PipelineControl = {
  checkCancelled?: () => Promise<boolean>;
  checkLease?: () => Promise<boolean>;
};

export async function createRun(filters: RunFilters, reviewRequired: boolean, workspaceId: string, createdBy: string) {
  return RunModel.create({
    workspaceId,
    createdBy,
    status: "queued",
    filters,
    reviewRequired,
    stats: ZERO_STATS,
    budgets: defaultRunBudgets(),
    completedStages: [],
    attemptCount: 0
  });
}

export async function executePipeline(
  runId: string,
  adsClient: AdsClient,
  apolloClient: ApolloClient,
  geminiClient: GeminiClient,
  control: PipelineControl = {}
) {
  const run = await RunModel.findById(runId);
  if (!run) throw new Error("Run no longer exists");
  await ensureRunTelemetry(runId);
  const completedStages = run.completedStages ?? [];
  const settings = await getSettings(run.workspaceId, run.createdBy);
  if (!settings) throw new Error("Settings could not be initialized");

  if (!completedStages.includes("discover")) {
    await beginStage(runId, "discover", "discovering");
    await throwIfCancelled(control);
    const discovered = await adsClient.fetchAll(run.filters, () => reserveProviderCall(runId, "ads"));
    await recordAdsResults(runId, discovered.length);
    await throwIfCancelled(control);
    const uniqueCompanies = deduplicate(discovered);
    for (const company of uniqueCompanies) {
      await throwIfCancelled(control);
      await CompanyModel.updateOne(
        { workspaceId: run.workspaceId, runId: run._id, domain: company.domain },
        {
          $set: {
            name: company.name,
            category: company.category,
            industry: company.industry,
            geography: company.geography,
            adFirstSeen: company.adFirstSeen,
            adLastSeen: company.adLastSeen,
            daysActive: company.daysActive,
            adCreativeSnippet: company.adCreativeSnippet,
            adUrl: company.adUrl
          },
          $addToSet: { adPlatforms: company.platform },
          $setOnInsert: { workspaceId: run.workspaceId, runId: run._id, domain: company.domain, icpMatch: false, icpReason: "Not scored", status: "discovered" }
        },
        { upsert: true }
      );
    }
    await completeStage(runId, "discover", {
      "stats.adsReturned": discovered.length,
      "stats.discovered": uniqueCompanies.length
    });
    completedStages.push("discover");
  }

  if (!completedStages.includes("qualify")) {
    await beginStage(runId, "qualify", "filtering");
    const companies = await CompanyModel.find({ workspaceId: run.workspaceId, runId: run._id });
    const concurrency = pLimit(env.GEMINI_CONCURRENCY);
    await settleOrThrow(companies.map((company) => concurrency(async () => {
      await throwIfCancelled(control);
      const discovered = toDiscoveredCompany(company);
      if (!company.analysisCompleted) {
        const analysis = await geminiClient.analyzeCompany(discovered, {
          icp: settings.icp,
          selectedCategory: run.filters.category,
          selectedIndustry: run.filters.industry
        }, () => reserveProviderCall(runId, "gemini"));
        await recordGeminiResult(runId, analysis?.usage, !analysis || analysis.source === "deterministic_fallback");
        await throwIfCancelled(control);
        company.category = run.filters.category || analysis?.category || company.category;
        company.industry = run.filters.industry || analysis?.industry || company.industry;
        company.aiMatch = analysis?.icpMatch;
        company.aiScore = analysis?.icpScore;
        company.aiReason = analysis?.icpReason;
        company.personalization = analysis?.personalization;
        company.analysisSource = analysis?.source;
        company.geminiModel = analysis?.model;
        company.geminiPromptVersion = analysis?.promptVersion;
        company.geminiLatencyMs = analysis?.latencyMs;
        company.geminiInputTokens = analysis?.usage?.inputTokens;
        company.geminiOutputTokens = analysis?.usage?.outputTokens;
        company.geminiFallbackReason = analysis?.fallbackReason;
        company.analysisCompleted = true;
      }
      const deterministic = scoreCompany({ ...discovered, category: company.category, industry: company.industry }, settings.icp);
      const excluded = deterministic.reason === "Company matches an ICP exclusion";
      const score = company.aiMatch !== undefined && company.aiReason && !excluded
        ? { match: company.aiMatch, reason: `Gemini ${company.aiScore ?? 0}/100: ${company.aiReason}` }
        : deterministic;
      company.icpMatch = score.match;
      company.icpReason = score.reason;
      company.status = score.match ? "qualified" : "filtered_out";
      await company.save();
    })));
    const qualified = await CompanyModel.countDocuments({ workspaceId: run.workspaceId, runId: run._id, status: "qualified" });
    await completeStage(runId, "qualify", {
      "stats.qualified": qualified,
      "stats.skipped": Math.max(0, companies.length - qualified)
    });
    completedStages.push("qualify");
  }

  if (!completedStages.includes("enrich")) {
    await beginStage(runId, "enrich", "enriching");
    const qualifiedCompanies = await CompanyModel.find({ workspaceId: run.workspaceId, runId: run._id, status: "qualified" });
    const concurrency = pLimit(env.APOLLO_CONCURRENCY);
    await settleOrThrow(qualifiedCompanies.map((company) => concurrency(async () => {
      await throwIfCancelled(control);
      const existingContacts = await ContactModel.countDocuments({ workspaceId: run.workspaceId, runId: run._id, companyId: company._id });
      if (existingContacts > 0) {
        company.status = "enriched";
        await company.save();
        return;
      }
      const candidates = await apolloClient.searchPeople(company.domain, {
        titles: [...settings.personas.titles],
        seniorities: [...settings.personas.seniorities],
        requireVerifiedEmail: settings.personas.requireVerifiedEmail
      }, () => reserveProviderCall(runId, "apollo", "search"));
      await throwIfCancelled(control);
      let saved = 0;
      for (const candidate of candidates) {
        await throwIfCancelled(control);
        if (saved >= env.APOLLO_CONTACTS_PER_COMPANY) break;
        const contact = await apolloClient.enrichPerson(candidate, company.domain, () => reserveProviderCall(runId, "apollo", "enrich"));
        await throwIfCancelled(control);
        if (!contact) continue;
        const hasReachableChannel = Boolean(contact.email || contact.personalEmails.length || contact.linkedinUrl || contact.twitterUrl || contact.facebookUrl || contact.githubUrl || contact.phoneNumbers.length);
        if (!hasReachableChannel) continue;
        await ContactModel.updateOne(
          { workspaceId: run.workspaceId, runId: run._id, apolloId: contact.id },
          {
            $set: {
              companyId: company._id,
              name: contact.name,
              title: contact.title,
              email: contact.email,
              personalEmails: contact.personalEmails,
              emailVerified: contact.emailVerified,
              linkedinUrl: contact.linkedinUrl,
              twitterUrl: contact.twitterUrl,
              facebookUrl: contact.facebookUrl,
              githubUrl: contact.githubUrl,
              phoneNumbers: contact.phoneNumbers,
              seniority: contact.seniority,
              tags: {
                source: "power_leads",
                adPlatform: company.adPlatforms[0] ?? "unknown",
                adSeenDate: company.adLastSeen,
                adSnippet: company.adCreativeSnippet,
                personalization: company.personalization
              }
            },
            $setOnInsert: { workspaceId: run.workspaceId, runId: run._id, apolloId: contact.id, enrollmentStatus: "pending" }
          },
          { upsert: true }
        );
        await recordApolloContact(runId);
        saved += 1;
      }
      company.status = saved > 0 ? "enriched" : "no_contacts";
      await company.save();
    })));
    const enriched = await ContactModel.countDocuments({ workspaceId: run.workspaceId, runId: run._id });
    const completion = completionForReview(run.reviewRequired, enriched);
    if (completion.autoApprove) {
      await ContactModel.updateMany({ workspaceId: run.workspaceId, runId: run._id, enrollmentStatus: "pending" }, { enrollmentStatus: "approved" });
    }
    await completeStage(runId, "enrich", {
      status: completion.status,
      "stats.enriched": enriched,
      "stats.approved": completion.approved
    });
  }
}

async function beginStage(runId: string, stage: PipelineStage, status: RunDocumentShape["status"]) {
  await beginStageMetric(runId, stage);
  await RunModel.updateOne({ _id: runId }, { status, currentStage: stage, $unset: { error: 1 } });
}

async function completeStage(runId: string, stage: PipelineStage, values: Record<string, unknown>) {
  await completeStageMetric(runId, stage);
  await RunModel.updateOne(
    { _id: runId },
    { $set: values, $addToSet: { completedStages: stage }, $unset: { currentStage: 1, error: 1 } }
  );
}

async function settleOrThrow(tasks: Promise<void>[]) {
  const results = await Promise.allSettled(tasks);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failure) throw failure.reason;
}

async function throwIfCancelled(control: PipelineControl) {
  if (await control.checkCancelled?.()) throw new PipelineCancelledError();
  if (control.checkLease && !await control.checkLease()) throw new PipelineLeaseLostError();
}

function toDiscoveredCompany(company: {
  name: string; domain: string; adPlatforms: string[]; adCreativeSnippet?: string; adFirstSeen?: Date; adLastSeen?: Date;
  daysActive?: number; adUrl?: string; industry?: string; geography?: string; category?: string;
}): DiscoveredCompany {
  return {
    name: company.name,
    domain: company.domain,
    platform: company.adPlatforms[0] ?? "unknown",
    adCreativeSnippet: company.adCreativeSnippet,
    adFirstSeen: company.adFirstSeen,
    adLastSeen: company.adLastSeen,
    daysActive: company.daysActive,
    adUrl: company.adUrl,
    industry: company.industry,
    geography: company.geography,
    category: company.category
  };
}

function deduplicate(companies: DiscoveredCompany[]) {
  const byDomain = new Map<string, DiscoveredCompany>();
  for (const company of companies) {
    const existing = byDomain.get(company.domain);
    if (!existing) {
      byDomain.set(company.domain, company);
      continue;
    }
    byDomain.set(company.domain, {
      ...existing,
      ...company,
      adFirstSeen: earliest(existing.adFirstSeen, company.adFirstSeen),
      adLastSeen: latest(existing.adLastSeen, company.adLastSeen),
      daysActive: Math.max(existing.daysActive ?? 0, company.daysActive ?? 0)
    });
  }
  return [...byDomain.values()];
}

function earliest(left?: Date, right?: Date) {
  if (!left) return right;
  if (!right) return left;
  return left < right ? left : right;
}

function latest(left?: Date, right?: Date) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

export function objectId(value: unknown) {
  return typeof value === "string" && /^[a-f\d]{24}$/i.test(value) ? value : null;
}
