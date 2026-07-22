import type { RunBudgets, RunFilters, RunStats, RunStatus, RunUsage } from "@power-leads/shared";
import { Schema, model } from "mongoose";

export type RunDocumentShape = {
  workspaceId: string;
  createdBy: string;
  status: RunStatus;
  filters: RunFilters;
  reviewRequired: boolean;
  stats: RunStats;
  error?: string;
  currentStage?: PipelineStage;
  completedStages: PipelineStage[];
  attemptCount: number;
  usage: RunUsage;
  budgets: RunBudgets;
  stageMetrics: Record<PipelineStage, { attempts: number; startedAt?: Date; completedAt?: Date; durationMs?: number }>;
  quota?: { provider: "ads" | "gemini" | "apollo"; limit: number; used: number };
  createdAt: Date;
  updatedAt: Date;
};

export const PIPELINE_STAGES = ["discover", "qualify", "enrich"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const filtersSchema = new Schema<RunFilters>(
  {
    keyword: String,
    industry: { type: String, default: "" },
    category: { type: String, default: "" },
    geography: String,
    platform: { type: String, required: true },
    minDaysActive: { type: Number, required: true },
    pageSize: { type: Number, required: true }
  },
  { _id: false }
);

const statsSchema = new Schema<RunStats>(
  {
    adsReturned: { type: Number, default: 0 },
    discovered: { type: Number, default: 0 },
    qualified: { type: Number, default: 0 },
    enriched: { type: Number, default: 0 },
    approved: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    enrolled: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 }
  },
  { _id: false }
);

const usageSchema = new Schema<RunUsage>({
  adsCalls: { type: Number, default: 0 },
  adsResults: { type: Number, default: 0 },
  geminiCalls: { type: Number, default: 0 },
  geminiFallbacks: { type: Number, default: 0 },
  geminiInputTokens: { type: Number, default: 0 },
  geminiOutputTokens: { type: Number, default: 0 },
  apolloCalls: { type: Number, default: 0 },
  apolloSearchCalls: { type: Number, default: 0 },
  apolloEnrichCalls: { type: Number, default: 0 },
  apolloContactsSaved: { type: Number, default: 0 }
}, { _id: false });

const budgetsSchema = new Schema<RunBudgets>({
  adsCalls: { type: Number, required: true, default: 100 },
  geminiCalls: { type: Number, required: true, default: 300 },
  apolloCalls: { type: Number, required: true, default: 1_000 }
}, { _id: false });

const stageMetricSchema = new Schema({
  attempts: { type: Number, default: 0 },
  startedAt: Date,
  completedAt: Date,
  durationMs: Number
}, { _id: false });

const runSchema = new Schema<RunDocumentShape>(
  {
    workspaceId: { type: String, required: true, trim: true, index: true },
    createdBy: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ["queued", "discovering", "filtering", "enriching", "pending_review", "sending", "enrolling", "done", "quota_limited", "cancelled", "failed"],
      required: true
    },
    filters: { type: filtersSchema, required: true },
    reviewRequired: { type: Boolean, default: true },
    stats: { type: statsSchema, required: true },
    error: String,
    currentStage: { type: String, enum: PIPELINE_STAGES },
    completedStages: { type: [String], enum: PIPELINE_STAGES, default: [] },
    attemptCount: { type: Number, default: 0 },
    usage: { type: usageSchema, default: () => ({}) },
    budgets: { type: budgetsSchema, required: true, default: () => ({ adsCalls: 100, geminiCalls: 300, apolloCalls: 1_000 }) },
    stageMetrics: {
      discover: { type: stageMetricSchema, default: () => ({}) },
      qualify: { type: stageMetricSchema, default: () => ({}) },
      enrich: { type: stageMetricSchema, default: () => ({}) }
    },
    quota: {
      provider: { type: String, enum: ["ads", "gemini", "apollo"] },
      limit: Number,
      used: Number
    }
  },
  { timestamps: true }
);

runSchema.index({ workspaceId: 1, createdAt: -1 });

export const RunModel = model<RunDocumentShape>("Run", runSchema);
