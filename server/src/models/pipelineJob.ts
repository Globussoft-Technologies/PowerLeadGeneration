import { Schema, Types, model } from "mongoose";

export const PIPELINE_JOB_STATUSES = ["queued", "running", "retry_wait", "completed", "failed", "cancelled"] as const;
export type PipelineJobStatus = (typeof PIPELINE_JOB_STATUSES)[number];

export type PipelineJobDocumentShape = {
  workspaceId: string;
  runId: Types.ObjectId;
  status: PipelineJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedBy?: string;
  lockedAt?: Date;
  leaseExpiresAt?: Date;
  cancelRequestedAt?: Date;
  lastError?: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const pipelineJobSchema = new Schema<PipelineJobDocumentShape>({
  workspaceId: { type: String, required: true, trim: true, index: true },
  runId: { type: Schema.Types.ObjectId, ref: "Run", required: true, unique: true, index: true },
  status: { type: String, enum: PIPELINE_JOB_STATUSES, required: true, default: "queued", index: true },
  attempts: { type: Number, required: true, default: 0 },
  maxAttempts: { type: Number, required: true, default: 3 },
  availableAt: { type: Date, required: true, default: Date.now, index: true },
  lockedBy: String,
  lockedAt: Date,
  leaseExpiresAt: { type: Date, index: true },
  cancelRequestedAt: Date,
  lastError: String,
  completedAt: Date
}, { timestamps: true });

pipelineJobSchema.index({ status: 1, availableAt: 1, createdAt: 1 });

export const PipelineJobModel = model<PipelineJobDocumentShape>("PipelineJob", pipelineJobSchema);
