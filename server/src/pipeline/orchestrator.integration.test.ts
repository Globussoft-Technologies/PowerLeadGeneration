import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { env } from "../config/env.js";
import type { AdsClient } from "../integrations/adsApi.js";
import type { ApolloClient } from "../integrations/apollo.js";
import type { GeminiClient } from "../integrations/gemini.js";
import { CompanyModel } from "../models/company.js";
import { RunModel } from "../models/run.js";
import { createRun, executePipeline } from "./orchestrator.js";

let mongo: MongoMemoryServer;
const originalGeminiConcurrency = env.GEMINI_CONCURRENCY;
const originalGeminiBudget = env.RUN_GEMINI_CALL_BUDGET;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  env.GEMINI_CONCURRENCY = 1;
});

beforeEach(async () => {
  await mongoose.connection.db?.dropDatabase();
});

afterAll(async () => {
  env.GEMINI_CONCURRENCY = originalGeminiConcurrency;
  env.RUN_GEMINI_CALL_BUDGET = originalGeminiBudget;
  await mongoose.disconnect();
  await mongo.stop();
});

describe("checkpointed pipeline", () => {
  it("resumes after a stage failure without repeating completed Ads or Gemini work", async () => {
    let adsCalls = 0;
    const geminiCalls = new Map<string, number>();
    let failSecondCompany = true;
    const adsClient: AdsClient = {
      fetchAll: async (_filters, beforeRequest) => {
        await beforeRequest?.();
        adsCalls += 1;
        return [
          { name: "Alpha", domain: "alpha.example", platform: "meta", industry: "Software", geography: "US" },
          { name: "Beta", domain: "beta.example", platform: "meta", industry: "Software", geography: "US" }
        ];
      }
    };
    const geminiClient: GeminiClient = {
      analyzeCompany: async (company, _context, beforeRequest) => {
        await beforeRequest?.();
        geminiCalls.set(company.domain, (geminiCalls.get(company.domain) ?? 0) + 1);
        if (company.domain === "beta.example" && failSecondCompany) {
          failSecondCompany = false;
          throw new Error("temporary Gemini failure");
        }
        return { category: "Technology", industry: "Software", icpMatch: true, icpScore: 90, icpReason: "Strong fit", personalization: "Recent campaign" };
      }
    };
    const apolloClient: ApolloClient = {
      searchPeople: async (_domain, _personas, beforeRequest) => { await beforeRequest?.(); return []; },
      enrichPerson: async () => null
    };
    const run = await createRun(
      { keyword: "software", industry: "", category: "", geography: "", platform: "facebook", minDaysActive: 0, pageSize: 100 },
      true,
      "workspace-a",
      "operator-a"
    );

    await expect(executePipeline(run.id, adsClient, apolloClient, geminiClient)).rejects.toThrow("temporary Gemini failure");
    expect((await RunModel.findById(run.id))?.completedStages).toEqual(["discover"]);

    await executePipeline(run.id, adsClient, apolloClient, geminiClient);

    const completed = await RunModel.findById(run.id);
    expect(completed?.completedStages).toEqual(["discover", "qualify", "enrich"]);
    expect(completed?.status).toBe("done");
    expect(adsCalls).toBe(1);
    expect(geminiCalls.get("alpha.example")).toBe(1);
    expect(geminiCalls.get("beta.example")).toBe(2);
    expect(await CompanyModel.countDocuments({ runId: run._id })).toBe(2);
    expect(completed?.usage.adsCalls).toBe(1);
    expect(completed?.usage.geminiCalls).toBe(3);
    expect(completed?.usage.apolloSearchCalls).toBe(2);
    expect(completed?.stageMetrics.discover.attempts).toBe(1);
    expect(completed?.stageMetrics.qualify.attempts).toBe(2);
    expect(completed?.stageMetrics.enrich.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stops before exceeding a persisted Gemini call budget", async () => {
    env.RUN_GEMINI_CALL_BUDGET = 1;
    const adsClient: AdsClient = {
      fetchAll: async (_filters, beforeRequest) => {
        await beforeRequest?.();
        return [
          { name: "Alpha", domain: "alpha.example", platform: "meta" },
          { name: "Beta", domain: "beta.example", platform: "meta" }
        ];
      }
    };
    let providerCalls = 0;
    const geminiClient: GeminiClient = {
      analyzeCompany: async (_company, _context, beforeRequest) => {
        await beforeRequest?.();
        providerCalls += 1;
        return { category: "Technology", industry: "Software", icpMatch: true, icpScore: 90, icpReason: "Fit", personalization: "Signal" };
      }
    };
    const apolloClient: ApolloClient = { searchPeople: async () => [], enrichPerson: async () => null };
    const run = await createRun(
      { keyword: "budget", industry: "", category: "", geography: "", platform: "facebook", minDaysActive: 0, pageSize: 100 },
      true,
      "workspace-a",
      "operator-a"
    );

    await expect(executePipeline(run.id, adsClient, apolloClient, geminiClient)).rejects.toMatchObject({
      provider: "gemini",
      limit: 1,
      used: 1
    });

    const limited = await RunModel.findById(run.id);
    expect(providerCalls).toBe(1);
    expect(limited?.usage.geminiCalls).toBe(1);
    expect(limited?.budgets.geminiCalls).toBe(1);
    expect(limited?.completedStages).toEqual(["discover"]);
    env.RUN_GEMINI_CALL_BUDGET = originalGeminiBudget;
  });
});
