import { PipelineJobModel } from "../models/pipelineJob.js";
import { RunModel } from "../models/run.js";
import type { UsageBudgetExceededError } from "./runUsage.js";

export async function enqueuePipelineRun(runId: string, workspaceId: string, maxAttempts: number) {
  return PipelineJobModel.findOneAndUpdate(
    { runId },
    {
      $set: { workspaceId, status: "queued", availableAt: new Date(), maxAttempts, attempts: 0 },
      $unset: { lockedBy: 1, lockedAt: 1, leaseExpiresAt: 1, cancelRequestedAt: 1, lastError: 1, completedAt: 1 }
    },
    { upsert: true, new: true }
  );
}

export async function claimPipelineJob(workerId: string, leaseMs: number, now = new Date()) {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  return PipelineJobModel.findOneAndUpdate(
    {
      cancelRequestedAt: { $exists: false },
      $or: [
        { status: { $in: ["queued", "retry_wait"] }, availableAt: { $lte: now } },
        { status: "running", leaseExpiresAt: { $lte: now } }
      ]
    },
    {
      $set: { status: "running", lockedBy: workerId, lockedAt: now, leaseExpiresAt },
      $inc: { attempts: 1 },
      $unset: { lastError: 1 }
    },
    { new: true, sort: { availableAt: 1, createdAt: 1 } }
  );
}

export async function renewPipelineLease(jobId: string, workerId: string, leaseMs: number) {
  return PipelineJobModel.updateOne(
    { _id: jobId, status: "running", lockedBy: workerId },
    { leaseExpiresAt: new Date(Date.now() + leaseMs) }
  );
}

export async function completePipelineJob(jobId: string, workerId: string) {
  return PipelineJobModel.updateOne(
    { _id: jobId, status: "running", lockedBy: workerId },
    {
      $set: { status: "completed", completedAt: new Date() },
      $unset: { lockedBy: 1, lockedAt: 1, leaseExpiresAt: 1, lastError: 1 }
    }
  );
}

export async function failPipelineJob(jobId: string, workerId: string, error: unknown) {
  const job = await PipelineJobModel.findOne({ _id: jobId, status: "running", lockedBy: workerId });
  if (!job) return null;
  const message = error instanceof Error ? error.message : "Unknown pipeline error";
  const terminal = job.attempts >= job.maxAttempts;
  const backoffMs = retryDelayMs(job.attempts);
  job.status = terminal ? "failed" : "retry_wait";
  job.lastError = message;
  job.availableAt = new Date(Date.now() + backoffMs);
  job.lockedBy = undefined;
  job.lockedAt = undefined;
  job.leaseExpiresAt = undefined;
  await job.save();
  await RunModel.updateOne(
    { _id: job.runId },
    terminal
      ? { status: "failed", error: message, attemptCount: job.attempts }
      : { status: "queued", error: `Retry ${job.attempts}/${job.maxAttempts}: ${message}`, attemptCount: job.attempts }
  );
  return job;
}

export async function requestPipelineCancellation(runId: string, workspaceId: string) {
  const now = new Date();
  const job = await PipelineJobModel.findOneAndUpdate(
    { runId, workspaceId, status: { $in: ["queued", "retry_wait", "running"] } },
    { $set: { cancelRequestedAt: now } },
    { new: true }
  );
  if (!job) return null;
  if (job.status !== "running") {
    job.status = "cancelled";
    await job.save();
    await RunModel.updateOne({ _id: runId, workspaceId }, { status: "cancelled", $unset: { currentStage: 1, error: 1 } });
  }
  return job;
}

export async function isPipelineCancellationRequested(jobId: string) {
  return Boolean(await PipelineJobModel.exists({ _id: jobId, cancelRequestedAt: { $exists: true } }));
}

export async function ownsPipelineLease(jobId: string, workerId: string) {
  return Boolean(await PipelineJobModel.exists({ _id: jobId, status: "running", lockedBy: workerId }));
}

export async function finishPipelineCancellation(jobId: string, workerId: string, runId: string) {
  await PipelineJobModel.updateOne(
    { _id: jobId, lockedBy: workerId },
    { $set: { status: "cancelled", completedAt: new Date() }, $unset: { lockedBy: 1, lockedAt: 1, leaseExpiresAt: 1 } }
  );
  await RunModel.updateOne({ _id: runId }, { status: "cancelled", $unset: { currentStage: 1, error: 1 } });
}

export async function finishPipelineQuota(jobId: string, workerId: string, runId: string, error: UsageBudgetExceededError) {
  await PipelineJobModel.updateOne(
    { _id: jobId, status: "running", lockedBy: workerId },
    {
      $set: { status: "completed", completedAt: new Date(), lastError: error.message },
      $unset: { lockedBy: 1, lockedAt: 1, leaseExpiresAt: 1 }
    }
  );
  await RunModel.updateOne(
    { _id: runId },
    {
      status: "quota_limited",
      error: error.message,
      quota: { provider: error.provider, limit: error.limit, used: error.used },
      $unset: { currentStage: 1 }
    }
  );
}

export function retryDelayMs(attempt: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}
