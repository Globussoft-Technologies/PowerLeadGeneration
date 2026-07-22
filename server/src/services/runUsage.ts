import type { PipelineStage } from "../models/run.js";
import { RunModel } from "../models/run.js";
import { env } from "../config/env.js";

export type BudgetProvider = "ads" | "gemini" | "apollo";
export type ApolloCallKind = "search" | "enrich";

export class UsageBudgetExceededError extends Error {
  constructor(readonly provider: BudgetProvider, readonly limit: number, readonly used: number) {
    super(`${providerLabel(provider)} call budget reached (${used}/${limit})`);
  }
}

export function defaultRunBudgets() {
  return {
    adsCalls: env.RUN_ADS_CALL_BUDGET,
    geminiCalls: env.RUN_GEMINI_CALL_BUDGET,
    apolloCalls: env.RUN_APOLLO_CALL_BUDGET
  };
}

export async function ensureRunTelemetry(runId: string) {
  const run = await RunModel.findById(runId).select("budgets usage stageMetrics");
  if (!run) throw new Error("Run no longer exists");
  if (!run.budgets) run.budgets = defaultRunBudgets();
  if (!run.usage) run.usage = emptyUsage();
  if (!run.stageMetrics) run.stageMetrics = emptyStageMetrics();
  await run.save();
}

export async function reserveProviderCall(runId: string, provider: BudgetProvider, apolloKind?: ApolloCallKind) {
  const usageField = provider === "ads" ? "adsCalls" : provider === "gemini" ? "geminiCalls" : "apolloCalls";
  const budgetField = provider === "ads" ? "adsCalls" : provider === "gemini" ? "geminiCalls" : "apolloCalls";
  const increments: Record<string, number> = { [`usage.${usageField}`]: 1 };
  if (provider === "apollo" && apolloKind) increments[`usage.apollo${apolloKind === "search" ? "Search" : "Enrich"}Calls`] = 1;
  const run = await RunModel.findOneAndUpdate(
    {
      _id: runId,
      $expr: {
        $lt: [
          { $ifNull: [`$usage.${usageField}`, 0] },
          { $ifNull: [`$budgets.${budgetField}`, 0] }
        ]
      }
    },
    { $inc: increments },
    { new: true }
  ).select(`usage.${usageField} budgets.${budgetField}`);
  if (run) return;
  const limited = await RunModel.findById(runId).select(`usage.${usageField} budgets.${budgetField}`);
  if (!limited) throw new Error("Run no longer exists");
  const limit = limited.budgets?.[budgetField] ?? 0;
  const used = limited.usage?.[usageField] ?? 0;
  throw new UsageBudgetExceededError(provider, limit, used);
}

export async function recordAdsResults(runId: string, results: number) {
  await RunModel.updateOne({ _id: runId }, { $inc: { "usage.adsResults": results } });
}

export async function recordGeminiResult(runId: string, usage?: { inputTokens?: number; outputTokens?: number }, fallback = false) {
  await RunModel.updateOne({ _id: runId }, {
    $inc: {
      "usage.geminiFallbacks": fallback ? 1 : 0,
      "usage.geminiInputTokens": usage?.inputTokens ?? 0,
      "usage.geminiOutputTokens": usage?.outputTokens ?? 0
    }
  });
}

export async function recordApolloContact(runId: string) {
  await RunModel.updateOne({ _id: runId }, { $inc: { "usage.apolloContactsSaved": 1 } });
}

export async function beginStageMetric(runId: string, stage: PipelineStage) {
  await RunModel.updateOne({ _id: runId }, {
    $set: { [`stageMetrics.${stage}.startedAt`]: new Date() },
    $inc: { [`stageMetrics.${stage}.attempts`]: 1 },
    $unset: { [`stageMetrics.${stage}.completedAt`]: 1, [`stageMetrics.${stage}.durationMs`]: 1 }
  });
}

export async function completeStageMetric(runId: string, stage: PipelineStage) {
  const run = await RunModel.findById(runId).select(`stageMetrics.${stage}.startedAt`);
  const completedAt = new Date();
  const startedAt = run?.stageMetrics?.[stage]?.startedAt;
  await RunModel.updateOne({ _id: runId }, {
    $set: {
      [`stageMetrics.${stage}.completedAt`]: completedAt,
      [`stageMetrics.${stage}.durationMs`]: startedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : 0
    }
  });
}

function emptyUsage() {
  return {
    adsCalls: 0,
    adsResults: 0,
    geminiCalls: 0,
    geminiFallbacks: 0,
    geminiInputTokens: 0,
    geminiOutputTokens: 0,
    apolloCalls: 0,
    apolloSearchCalls: 0,
    apolloEnrichCalls: 0,
    apolloContactsSaved: 0
  };
}

function emptyStageMetrics() {
  return { discover: { attempts: 0 }, qualify: { attempts: 0 }, enrich: { attempts: 0 } };
}

function providerLabel(provider: BudgetProvider) {
  return provider === "ads" ? "Ads" : provider === "gemini" ? "Gemini" : "Apollo";
}
