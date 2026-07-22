import { GoogleGenAI } from "@google/genai";
import pRetry, { AbortError } from "p-retry";
import { z } from "zod";
import { env } from "../config/env.js";
import { getCategoryCatalog } from "../services/categoryCatalog.js";
import { scoreCompany, type IcpCriteria } from "../services/icpScorer.js";
import type { DiscoveredCompany } from "./adsApi.js";
import { UsageBudgetExceededError } from "../services/runUsage.js";

const geminiAnalysisSchema = z.object({
  category: z.string().trim().max(120).default(""),
  industry: z.string().trim().max(120).default(""),
  icpMatch: z.boolean(),
  icpScore: z.number().int().min(0).max(100),
  icpReason: z.string().trim().min(1).max(500),
  personalization: z.string().trim().min(1).max(500)
});
export const GEMINI_PROMPT_VERSION = "company-analysis-v1";

export type GeminiAnalysis = z.infer<typeof geminiAnalysisSchema>;

export type GeminiContext = {
  icp: IcpCriteria;
  selectedCategory: string;
  selectedIndustry: string;
};

export type GeminiAnalysisResult = GeminiAnalysis & {
  usage?: { inputTokens?: number; outputTokens?: number };
  source?: "gemini" | "deterministic_fallback" | "mock";
  model?: string;
  promptVersion?: string;
  latencyMs?: number;
  fallbackReason?: string;
};

export interface GeminiClient {
  analyzeCompany(company: DiscoveredCompany, context: GeminiContext, beforeRequest?: () => Promise<void>): Promise<GeminiAnalysisResult | null>;
}

class LiveGeminiClient implements GeminiClient {
  private readonly ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  async analyzeCompany(company: DiscoveredCompany, context: GeminiContext, beforeRequest?: () => Promise<void>) {
    const startedAt = Date.now();
    try {
      const response = await pRetry(async () => {
        await beforeRequest?.();
        try {
          return await this.ai.models.generateContent({
            model: env.GEMINI_MODEL,
            contents: buildPrompt(company, context),
            config: {
              temperature: 0.1,
              responseMimeType: "application/json",
              responseJsonSchema: analysisJsonSchema,
              abortSignal: AbortSignal.timeout(30_000)
            }
          });
        } catch (error) {
          const status = apiErrorStatus(error);
          if (status && status !== 429 && status < 500) {
            throw new AbortError(error instanceof Error ? error.message : `Gemini request failed (${status})`);
          }
          throw error;
        }
      }, {
        retries: 2,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 3_000,
        shouldRetry: (error) => !(error instanceof UsageBudgetExceededError)
      });

      const text = response.text;
      if (!text) {
        const finishReason = response.candidates?.[0]?.finishReason ?? "unknown";
        throw new Error(`Gemini returned no text (finish reason: ${finishReason})`);
      }
      return {
        ...normalizeAnalysis(geminiAnalysisSchema.parse(JSON.parse(text)), context),
        source: "gemini" as const,
        model: env.GEMINI_MODEL,
        promptVersion: GEMINI_PROMPT_VERSION,
        latencyMs: Date.now() - startedAt,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount
        }
      };
    } catch (error) {
      if (error instanceof UsageBudgetExceededError) throw error;
      const message = error instanceof Error ? error.message : "Unknown Gemini error";
      console.warn(`Gemini analysis fallback for ${company.domain}: ${message}`);
      return {
        ...fallbackAnalysis(company, context),
        source: "deterministic_fallback" as const,
        model: env.GEMINI_MODEL,
        promptVersion: GEMINI_PROMPT_VERSION,
        latencyMs: Date.now() - startedAt,
        fallbackReason: message
      };
    }
  }
}

class MockGeminiClient implements GeminiClient {
  async analyzeCompany(company: DiscoveredCompany, context: GeminiContext, beforeRequest?: () => Promise<void>) {
    await beforeRequest?.();
    return {
      ...fallbackAnalysis(company, context),
      source: "mock" as const,
      model: "mock",
      promptVersion: GEMINI_PROMPT_VERSION,
      latencyMs: 0
    };
  }
}

function fallbackAnalysis(company: DiscoveredCompany, context: GeminiContext): GeminiAnalysis {
  const classifiedCompany = { ...company, category: context.selectedCategory || company.category, industry: context.selectedIndustry || company.industry };
  const deterministic = scoreCompany(classifiedCompany, context.icp);
  return {
    category: classifiedCompany.category || "",
    industry: classifiedCompany.industry || "",
    icpMatch: deterministic.match,
    icpScore: deterministic.match ? 85 : 20,
    icpReason: deterministic.reason,
    personalization: company.adCreativeSnippet
      ? `I noticed your campaign about ${company.adCreativeSnippet.slice(0, 180)}`
      : `I noticed ${company.name}'s active advertising campaign.`
  };
}

const analysisJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", description: "Best exact category title from the supplied category list, or an empty string." },
    industry: { type: "string", description: "Best exact target or existing industry title, or an empty string." },
    icpMatch: { type: "boolean", description: "Whether this company matches the supplied ICP." },
    icpScore: { type: "integer", minimum: 0, maximum: 100 },
    icpReason: { type: "string", description: "Concise evidence-based explanation." },
    personalization: { type: "string", description: "One concise, factual email opening hook based on the ad signal." }
  },
  required: ["category", "industry", "icpMatch", "icpScore", "icpReason", "personalization"],
  additionalProperties: false
};

function buildPrompt(company: DiscoveredCompany, context: GeminiContext) {
  const categoryTitles = getCategoryCatalog().map((category) => category.title);
  return [
    "Analyze this advertising company for a B2B prospecting pipeline.",
    "Return only the requested structured response. Do not invent facts.",
    `Company: ${company.name}`,
    `Domain: ${company.domain}`,
    `Ad text: ${company.adCreativeSnippet ?? "Not supplied"}`,
    `Ads category: ${company.category ?? "Not supplied"}`,
    `Ads industry: ${company.industry ?? "Not supplied"}`,
    `Ads geography: ${company.geography ?? "Not supplied"}`,
    `Selected category filter: ${context.selectedCategory || "None"}`,
    `Selected industry filter: ${context.selectedIndustry || "None"}`,
    `Allowed category titles: ${categoryTitles.join(" | ")}`,
    `Target ICP industries: ${context.icp.industries.join(" | ")}`,
    `Target ICP geographies: ${context.icp.geographies.join(" | ")}`,
    `ICP exclusions: ${context.icp.exclusions.join(" | ") || "None"}`,
    "Use an exact supplied category/industry spelling when a supported match exists. Respect exclusions. Keep the personalization under two sentences."
  ].join("\n");
}

export function normalizeAnalysis(analysis: GeminiAnalysis, context: GeminiContext): GeminiAnalysis {
  const catalog = getCategoryCatalog();
  const category = context.selectedCategory
    || catalog.find((item) => item.title.toLowerCase() === analysis.category.toLowerCase())?.title
    || "";
  const catalogIndustries = category
    ? catalog.find((item) => item.title === category)?.industries.map((item) => item.title) ?? []
    : catalog.flatMap((item) => item.industries.map((industry) => industry.title));
  const industryCandidates = [...catalogIndustries, ...context.icp.industries];
  const industry = context.selectedIndustry
    || industryCandidates.find((item) => item.toLowerCase() === analysis.industry.toLowerCase())
    || "";
  return { ...analysis, category, industry };
}

function apiErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  return typeof error.status === "number" ? error.status : undefined;
}

export function createGeminiClient(mode: "mock" | "live" = env.GEMINI_MODE): GeminiClient {
  return mode === "live" ? new LiveGeminiClient() : new MockGeminiClient();
}
