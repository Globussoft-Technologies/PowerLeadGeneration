import { Schema, Types, model } from "mongoose";

export type CompanyStatus = "discovered" | "filtered_out" | "qualified" | "enriched" | "no_contacts";

export type CompanyDocumentShape = {
  workspaceId: string;
  runId: Types.ObjectId;
  name: string;
  domain: string;
  category?: string;
  industry?: string;
  geography?: string;
  adPlatforms: string[];
  adFirstSeen?: Date;
  adLastSeen?: Date;
  daysActive?: number;
  adCreativeSnippet?: string;
  adUrl?: string;
  icpMatch: boolean;
  icpReason: string;
  aiMatch?: boolean;
  aiScore?: number;
  aiReason?: string;
  personalization?: string;
  analysisCompleted: boolean;
  analysisSource?: "gemini" | "deterministic_fallback" | "mock";
  geminiModel?: string;
  geminiPromptVersion?: string;
  geminiLatencyMs?: number;
  geminiInputTokens?: number;
  geminiOutputTokens?: number;
  geminiFallbackReason?: string;
  status: CompanyStatus;
};

const companySchema = new Schema<CompanyDocumentShape>(
  {
    workspaceId: { type: String, required: true, trim: true, index: true },
    runId: { type: Schema.Types.ObjectId, ref: "Run", required: true, index: true },
    name: { type: String, required: true, trim: true },
    domain: { type: String, required: true, lowercase: true, trim: true },
    category: String,
    industry: String,
    geography: String,
    adPlatforms: { type: [String], default: [] },
    adFirstSeen: Date,
    adLastSeen: Date,
    daysActive: Number,
    adCreativeSnippet: String,
    adUrl: String,
    icpMatch: { type: Boolean, default: false },
    icpReason: { type: String, default: "Not scored" },
    aiMatch: Boolean,
    aiScore: Number,
    aiReason: String,
    personalization: String,
    analysisCompleted: { type: Boolean, default: false },
    analysisSource: { type: String, enum: ["gemini", "deterministic_fallback", "mock"] },
    geminiModel: String,
    geminiPromptVersion: String,
    geminiLatencyMs: Number,
    geminiInputTokens: Number,
    geminiOutputTokens: Number,
    geminiFallbackReason: String,
    status: {
      type: String,
      enum: ["discovered", "filtered_out", "qualified", "enriched", "no_contacts"],
      default: "discovered"
    }
  },
  { timestamps: true }
);

companySchema.index({ workspaceId: 1, runId: 1, domain: 1 }, { unique: true });

export const CompanyModel = model<CompanyDocumentShape>("Company", companySchema);
