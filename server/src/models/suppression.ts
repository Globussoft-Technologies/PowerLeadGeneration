import { Schema, model } from "mongoose";

export const SUPPRESSION_REASONS = ["bounce", "spamreport", "unsubscribe", "group_unsubscribe", "dropped"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

const suppressionSchema = new Schema({
  workspaceId: { type: String, required: true, trim: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  reason: { type: String, enum: SUPPRESSION_REASONS, required: true },
  source: { type: String, enum: ["sendgrid_webhook", "manual"], required: true },
  providerEventId: String,
  suppressedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

suppressionSchema.index({ workspaceId: 1, email: 1 }, { unique: true });

export const SuppressionModel = model("Suppression", suppressionSchema);
