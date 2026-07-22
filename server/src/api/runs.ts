import type { CompanyDto, RunDetailDto, RunDto, SendRunMailResult } from "@power-leads/shared";
import { Router } from "express";
import type { HydratedDocument } from "mongoose";
import { z } from "zod";
import type { AdsClient } from "../integrations/adsApi.js";
import type { ApolloClient } from "../integrations/apollo.js";
import type { GeminiClient } from "../integrations/gemini.js";
import type { MailClient } from "../integrations/sendGrid.js";
import { exportContactsCsv, type CsvContactRow } from "../integrations/csvExporter.js";
import { CompanyModel } from "../models/company.js";
import { ContactModel } from "../models/contact.js";
import { RunModel, type RunDocumentShape } from "../models/run.js";
import { PipelineJobModel } from "../models/pipelineJob.js";
import { createRun, objectId } from "../pipeline/orchestrator.js";
import { getCategoryCatalog } from "../services/categoryCatalog.js";
import { toContactDto } from "./contacts.js";
import { sendApprovedMail } from "../services/mailDelivery.js";
import { unsupportedPlaceholders } from "../services/mailTemplate.js";
import { requireRole } from "../security/auth.js";
import { recordAuditEvent } from "../services/audit.js";
import { enqueuePipelineRun, requestPipelineCancellation } from "../services/pipelineQueue.js";
import { env } from "../config/env.js";

const categoryCatalog = getCategoryCatalog();
const ACTIVE_RUN_STATUSES = ["queued", "discovering", "filtering", "enriching", "sending", "enrolling"];

const createRunSchema = z.object({
  filters: z.object({
    keyword: z.string().trim().max(120).optional().default(""),
    industry: z.string().trim().max(120).optional().default(""),
    category: z.string().trim().max(120).optional().default(""),
    geography: z.string().trim().max(120).optional().default(""),
    platform: z.string().trim().min(1).max(40).default("facebook"),
    minDaysActive: z.number().int().min(0).max(3650).default(30),
    pageSize: z.number().int().min(1).max(100).default(100)
  }),
  reviewRequired: z.boolean().default(true)
}).superRefine((input, context) => {
  if (!input.filters.category) {
    if (input.filters.industry) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["filters", "industry"], message: "Select a category before selecting an industry" });
    }
    return;
  }

  const category = categoryCatalog.find((item) => item.title === input.filters.category);
  if (!category) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["filters", "category"], message: "Unknown category" });
    return;
  }
  if (input.filters.industry && !category.industries.some((industry) => industry.title === input.filters.industry)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["filters", "industry"], message: "Industry does not belong to the selected category" });
  }
});

const sendMailSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10_000),
  contactIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid contact ID")).min(1).max(100).optional()
}).superRefine((input, context) => {
  for (const [field, template] of [["subject", input.subject], ["body", input.body]] as const) {
    const unsupported = unsupportedPlaceholders(template);
    if (unsupported.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `Unsupported placeholder: ${unsupported[0]}` });
    }
  }
});

export function runsRouter(adsClient: AdsClient, apolloClient: ApolloClient, geminiClient: GeminiClient, mailClient: MailClient) {
  const router = Router();

  router.post("/", requireRole("admin", "operator"), async (request, response, next) => {
    try {
      const input = createRunSchema.parse(request.body);
      const run = await createRun(input.filters, input.reviewRequired, request.actor.workspaceId, request.actor.userId);
      await enqueuePipelineRun(run.id, request.actor.workspaceId, env.PIPELINE_MAX_ATTEMPTS);
      await recordAuditEvent(request, "run.created", "run", run.id, { filters: input.filters, reviewRequired: input.reviewRequired });
      response.status(202).json(toRunDto(run));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:runId/cancel", requireRole("admin", "operator"), async (request, response, next) => {
    try {
      const runId = objectId(request.params.runId);
      if (!runId) return response.status(400).json({ error: "Invalid run ID" });
      const run = await RunModel.findOne({ _id: runId, workspaceId: request.actor.workspaceId });
      if (!run) return response.status(404).json({ error: "Run not found" });
      if (!ACTIVE_RUN_STATUSES.includes(run.status)) return response.status(409).json({ error: "Only an active run can be cancelled" });
      const job = await requestPipelineCancellation(runId, request.actor.workspaceId);
      if (!job) return response.status(409).json({ error: "The run no longer has an active pipeline job" });
      await recordAuditEvent(request, "run.cancel_requested", "run", runId, { stage: run.currentStage });
      return response.status(202).json({ cancelled: job.status === "cancelled", cancellationRequested: true });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:runId/retry", requireRole("admin", "operator"), async (request, response, next) => {
    try {
      const runId = objectId(request.params.runId);
      if (!runId) return response.status(400).json({ error: "Invalid run ID" });
      const run = await RunModel.findOne({ _id: runId, workspaceId: request.actor.workspaceId });
      if (!run) return response.status(404).json({ error: "Run not found" });
      if (!["failed", "cancelled"].includes(run.status)) return response.status(409).json({ error: "Only a failed or cancelled run can be retried" });
      await enqueuePipelineRun(runId, request.actor.workspaceId, env.PIPELINE_MAX_ATTEMPTS);
      run.status = "queued";
      run.attemptCount = 0;
      run.error = undefined;
      await run.save();
      await recordAuditEvent(request, "run.retry_requested", "run", runId, { completedStages: run.completedStages });
      return response.status(202).json(toRunDto(run));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/", async (request, response, next) => {
    try {
      const runs = await RunModel.find({ workspaceId: request.actor.workspaceId }).sort({ createdAt: -1 }).limit(50);
      response.json(runs.map(toRunDto));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:runId", requireRole("admin", "operator"), async (request, response, next) => {
    try {
      const runId = objectId(request.params.runId);
      if (!runId) return response.status(400).json({ error: "Invalid run ID" });

      const run = await RunModel.findOne({ _id: runId, workspaceId: request.actor.workspaceId });
      if (!run) return response.status(404).json({ error: "Run not found" });
      if (ACTIVE_RUN_STATUSES.includes(run.status)) {
        return response.status(409).json({ error: "An active run cannot be deleted" });
      }

      await Promise.all([
        ContactModel.deleteMany({ runId, workspaceId: request.actor.workspaceId }),
        CompanyModel.deleteMany({ runId, workspaceId: request.actor.workspaceId }),
        PipelineJobModel.deleteMany({ runId, workspaceId: request.actor.workspaceId })
      ]);
      await RunModel.deleteOne({ _id: runId, workspaceId: request.actor.workspaceId });
      await recordAuditEvent(request, "run.deleted", "run", runId, { status: run.status });

      return response.json({ deleted: true, id: runId });
    } catch (error) {
      return next(error);
    }
  });

  router.post("/:runId/send", requireRole("admin", "operator"), async (request, response, next) => {
    try {
      const runId = objectId(request.params.runId);
      if (!runId) return response.status(400).json({ error: "Invalid run ID" });
      const run = await RunModel.findOne({ _id: runId, workspaceId: request.actor.workspaceId });
      if (!run) return response.status(404).json({ error: "Run not found" });
      if (ACTIVE_RUN_STATUSES.includes(run.status)) {
        return response.status(409).json({ error: "Wait for the run to finish before sending mail" });
      }
      const input = sendMailSchema.parse(request.body);
      const result: SendRunMailResult = await sendApprovedMail(runId, request.actor.workspaceId, input, mailClient);
      await recordAuditEvent(request, "run.mail_sent", "run", runId, { requestedContactIds: input.contactIds, ...result });
      return response.json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:runId/export.csv", async (request, response, next) => {
    try {
      const runId = objectId(request.params.runId);
      if (!runId) return response.status(400).json({ error: "Invalid run ID" });
      const run = await RunModel.findOne({ _id: runId, workspaceId: request.actor.workspaceId });
      if (!run) return response.status(404).json({ error: "Run not found" });

      const contacts = await ContactModel.find({ runId, workspaceId: request.actor.workspaceId, enrollmentStatus: { $in: ["approved", "sent"] } });
      const companyIds = [...new Set(contacts.map((contact) => contact.companyId.toString()))];
      const companies = await CompanyModel.find({ _id: { $in: companyIds }, workspaceId: request.actor.workspaceId });
      const companiesById = new Map(companies.map((company) => [company.id, company]));

      const rows: CsvContactRow[] = contacts.map((contact) => {
        const company = companiesById.get(contact.companyId.toString());
        return {
          company_name: company?.name,
          company_domain: company?.domain,
          company_category: company?.category,
          company_industry: company?.industry,
          contact_name: contact.name,
          title: contact.title,
          email: contact.email,
          email_verified: contact.emailVerified,
          personal_emails: (contact.personalEmails ?? []).join("; "),
          phone_numbers: (contact.phoneNumbers ?? []).map((phone) => formatPhone(phone)).join("; "),
          mobile_numbers: (contact.phoneNumbers ?? []).filter((phone) => phone.type?.toLowerCase().includes("mobile")).map((phone) => phone.number).join("; "),
          linkedin_url: contact.linkedinUrl,
          twitter_url: contact.twitterUrl,
          facebook_url: contact.facebookUrl,
          github_url: contact.githubUrl,
          seniority: contact.seniority,
          ad_platform: contact.tags.adPlatform,
          ad_seen_date: contact.tags.adSeenDate?.toISOString().slice(0, 10),
          ad_creative_snippet: contact.tags.adSnippet,
          personalized_hook: contact.tags.personalization,
          source: "power_leads"
        };
      });

      await recordAuditEvent(request, "run.exported", "run", runId, { contacts: rows.length });
      response.setHeader("content-type", "text/csv; charset=utf-8");
      response.setHeader("content-disposition", `attachment; filename="power-leads-${runId}.csv"`);
      return response.send(exportContactsCsv(rows));
    } catch (error) {
      return next(error);
    }
  });

  router.get("/:runId", async (request, response, next) => {
    try {
      const runId = objectId(request.params.runId);
      if (!runId) return response.status(400).json({ error: "Invalid run ID" });

      const [run, companies, contacts] = await Promise.all([
        RunModel.findOne({ _id: runId, workspaceId: request.actor.workspaceId }),
        CompanyModel.find({ runId, workspaceId: request.actor.workspaceId }).sort({ icpMatch: -1, name: 1 }),
        ContactModel.find({ runId, workspaceId: request.actor.workspaceId }).sort({ companyId: 1, seniority: 1, name: 1 })
      ]);
      if (!run) return response.status(404).json({ error: "Run not found" });

      if (run.status === "pending_review" && contacts.every((contact) => contact.enrollmentStatus !== "pending")) {
        run.status = "done";
        run.stats.approved = contacts.filter((contact) => ["approved", "sent"].includes(contact.enrollmentStatus)).length;
        await run.save();
      }

      const detail: RunDetailDto = {
        ...toRunDto(run),
        companies: companies.map((company): CompanyDto => ({
          id: company.id,
          runId: company.runId.toString(),
          name: company.name,
          domain: company.domain,
          category: company.category,
          industry: company.industry,
          geography: company.geography,
          adPlatforms: company.adPlatforms,
          adFirstSeen: company.adFirstSeen?.toISOString(),
          adLastSeen: company.adLastSeen?.toISOString(),
          daysActive: company.daysActive,
          adCreativeSnippet: company.adCreativeSnippet,
          adUrl: company.adUrl,
          icpMatch: company.icpMatch,
          icpReason: company.icpReason,
          aiScore: company.aiScore,
          aiReason: company.aiReason,
          personalization: company.personalization,
          analysisSource: company.analysisSource,
          geminiModel: company.geminiModel,
          geminiPromptVersion: company.geminiPromptVersion,
          geminiLatencyMs: company.geminiLatencyMs,
          geminiInputTokens: company.geminiInputTokens,
          geminiOutputTokens: company.geminiOutputTokens,
          geminiFallbackReason: company.geminiFallbackReason,
          status: company.status
        })),
        contacts: contacts.map(toContactDto)
      };
      return response.json(detail);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function toRunDto(run: HydratedDocument<RunDocumentShape>): RunDto {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    createdBy: run.createdBy,
    createdAt: run.createdAt.toISOString(),
    status: run.status,
    filters: run.filters,
    reviewRequired: run.reviewRequired,
    stats: run.stats,
    error: run.error,
    currentStage: run.currentStage,
    completedStages: run.completedStages ?? [],
    attemptCount: run.attemptCount ?? 0,
    usage: run.usage ?? {
      adsCalls: 0, adsResults: 0, geminiCalls: 0, geminiFallbacks: 0, geminiInputTokens: 0, geminiOutputTokens: 0,
      apolloCalls: 0, apolloSearchCalls: 0, apolloEnrichCalls: 0, apolloContactsSaved: 0
    },
    budgets: run.budgets ?? { adsCalls: 0, geminiCalls: 0, apolloCalls: 0 },
    stageMetrics: {
      discover: toStageMetric(run.stageMetrics?.discover),
      qualify: toStageMetric(run.stageMetrics?.qualify),
      enrich: toStageMetric(run.stageMetrics?.enrich)
    },
    quota: run.quota?.provider && run.quota.limit !== undefined && run.quota.used !== undefined
      ? { provider: run.quota.provider, limit: run.quota.limit, used: run.quota.used }
      : undefined
  };
}

function toStageMetric(metric?: { attempts: number; startedAt?: Date; completedAt?: Date; durationMs?: number }) {
  return {
    attempts: metric?.attempts ?? 0,
    startedAt: metric?.startedAt?.toISOString(),
    completedAt: metric?.completedAt?.toISOString(),
    durationMs: metric?.durationMs
  };
}

function formatPhone(phone: { number: string; type?: string; status?: string }) {
  const details = [phone.type, phone.status].filter(Boolean).join("/");
  return details ? `${phone.number} (${details})` : phone.number;
}
