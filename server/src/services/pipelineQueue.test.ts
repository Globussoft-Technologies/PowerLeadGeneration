import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PipelineJobModel } from "../models/pipelineJob.js";
import { RunModel } from "../models/run.js";
import {
  claimPipelineJob,
  enqueuePipelineRun,
  failPipelineJob,
  finishPipelineQuota,
  ownsPipelineLease,
  requestPipelineCancellation,
  retryDelayMs
} from "./pipelineQueue.js";
import { UsageBudgetExceededError } from "./runUsage.js";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("durable pipeline queue", () => {
  it("allows only one worker to claim a queued job", async () => {
    const run = await createQueuedRun();
    await enqueuePipelineRun(run.id, run.workspaceId, 3);

    const [first, second] = await Promise.all([
      claimPipelineJob("worker-a", 60_000),
      claimPipelineJob("worker-b", 60_000)
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect((first ?? second)?.attempts).toBe(1);
    expect((first ?? second)?.status).toBe("running");
  });

  it("recovers an expired worker lease without creating another job", async () => {
    const run = await createQueuedRun();
    await enqueuePipelineRun(run.id, run.workspaceId, 3);
    const started = new Date();
    const first = await claimPipelineJob("worker-a", 10_000, started);
    expect(first).toBeTruthy();

    const recovered = await claimPipelineJob("worker-b", 10_000, new Date(started.getTime() + 11_000));
    expect(recovered?.id).toBe(first?.id);
    expect(recovered?.attempts).toBe(2);
    expect(recovered?.lockedBy).toBe("worker-b");
    expect(await ownsPipelineLease(first!.id, "worker-a")).toBe(false);
    expect(await ownsPipelineLease(first!.id, "worker-b")).toBe(true);
    expect(await PipelineJobModel.countDocuments()).toBe(1);
  });

  it("backs off temporary failures and marks the run failed at the attempt limit", async () => {
    const run = await createQueuedRun();
    await enqueuePipelineRun(run.id, run.workspaceId, 2);
    const first = await claimPipelineJob("worker-a", 60_000);
    await failPipelineJob(first!.id, "worker-a", new Error("temporary outage"));

    const waiting = await PipelineJobModel.findById(first!.id);
    expect(waiting?.status).toBe("retry_wait");
    expect((await RunModel.findById(run.id))?.status).toBe("queued");

    waiting!.availableAt = new Date(0);
    await waiting!.save();
    const second = await claimPipelineJob("worker-b", 60_000);
    await failPipelineJob(second!.id, "worker-b", new Error("still unavailable"));

    expect((await PipelineJobModel.findById(first!.id))?.status).toBe("failed");
    const failedRun = await RunModel.findById(run.id);
    expect(failedRun?.status).toBe("failed");
    expect(failedRun?.attemptCount).toBe(2);
  });

  it("cancels queued work before a provider call can start", async () => {
    const run = await createQueuedRun();
    await enqueuePipelineRun(run.id, run.workspaceId, 3);
    const job = await requestPipelineCancellation(run.id, run.workspaceId);

    expect(job?.status).toBe("cancelled");
    expect((await RunModel.findById(run.id))?.status).toBe("cancelled");
    expect(await claimPipelineJob("worker-a", 60_000)).toBeNull();
  });

  it("uses bounded exponential retry delays", () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(20)).toBe(60_000);
  });

  it("finishes a budget-limited job without retrying it as a provider failure", async () => {
    const run = await createQueuedRun();
    await enqueuePipelineRun(run.id, run.workspaceId, 3);
    const job = await claimPipelineJob("worker-a", 60_000);

    await finishPipelineQuota(job!.id, "worker-a", run.id, new UsageBudgetExceededError("apollo", 10, 10));

    expect((await PipelineJobModel.findById(job!.id))?.status).toBe("completed");
    const limited = await RunModel.findById(run.id);
    expect(limited?.status).toBe("quota_limited");
    expect(limited?.quota).toMatchObject({ provider: "apollo", limit: 10, used: 10 });
  });
});

function createQueuedRun() {
  return RunModel.create({
    workspaceId: "workspace-a",
    createdBy: "operator-a",
    status: "queued",
    filters: { keyword: "test", industry: "", category: "", geography: "", platform: "facebook", minDaysActive: 0, pageSize: 100 },
    reviewRequired: true,
    stats: { adsReturned: 0, discovered: 0, qualified: 0, enriched: 0, approved: 0, sent: 0, enrolled: 0, skipped: 0 },
    completedStages: [],
    attemptCount: 0,
    budgets: { adsCalls: 100, geminiCalls: 300, apolloCalls: 1_000 }
  });
}
