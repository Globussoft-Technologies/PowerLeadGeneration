import { randomUUID } from "node:crypto";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./db/connection.js";
import { createAdsClient } from "./integrations/adsApi.js";
import { createApolloClient } from "./integrations/apollo.js";
import { createGeminiClient } from "./integrations/gemini.js";
import { PipelineCancelledError, PipelineLeaseLostError, executePipeline } from "./pipeline/orchestrator.js";
import {
  claimPipelineJob,
  completePipelineJob,
  failPipelineJob,
  finishPipelineCancellation,
  finishPipelineQuota,
  isPipelineCancellationRequested,
  ownsPipelineLease,
  renewPipelineLease
} from "./services/pipelineQueue.js";
import { RunModel } from "./models/run.js";
import { UsageBudgetExceededError } from "./services/runUsage.js";

const workerId = `${process.pid}-${randomUUID()}`;
const adsClient = createAdsClient();
const apolloClient = createApolloClient();
const geminiClient = createGeminiClient();
let stopping = false;
let activeJobId: string | null = null;

process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));

await connectDatabase();
console.log(`Power Leads pipeline worker ${workerId} started`);

while (!stopping) {
  const job = await claimPipelineJob(workerId, env.WORKER_LEASE_MS);
  if (!job) {
    await delay(env.WORKER_POLL_MS);
    continue;
  }

  activeJobId = job.id;
  await RunModel.updateOne({ _id: job.runId }, { attemptCount: job.attempts });
  const heartbeat = setInterval(() => {
    void renewPipelineLease(job.id, workerId, env.WORKER_LEASE_MS).catch((error) => console.error("Worker heartbeat failed", error));
  }, Math.max(1_000, Math.floor(env.WORKER_LEASE_MS / 3)));
  heartbeat.unref();

  try {
    await executePipeline(job.runId.toString(), adsClient, apolloClient, geminiClient, {
      checkCancelled: async () => await isPipelineCancellationRequested(job.id),
      checkLease: async () => await ownsPipelineLease(job.id, workerId)
    });
    await completePipelineJob(job.id, workerId);
  } catch (error) {
    if (error instanceof PipelineCancelledError) {
      await finishPipelineCancellation(job.id, workerId, job.runId.toString());
    } else if (error instanceof UsageBudgetExceededError) {
      await finishPipelineQuota(job.id, workerId, job.runId.toString(), error);
    } else if (error instanceof PipelineLeaseLostError) {
      console.warn(`Pipeline job ${job.id} moved to another worker after its lease expired`);
    } else {
      console.error(`Pipeline job ${job.id} failed`, error);
      await failPipelineJob(job.id, workerId, error);
    }
  } finally {
    clearInterval(heartbeat);
    activeJobId = null;
  }
}

await disconnectDatabase();
console.log("Power Leads pipeline worker stopped");

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function requestStop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received; worker will stop${activeJobId ? " after its current job" : ""}`);
}
