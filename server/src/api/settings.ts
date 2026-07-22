import type { SettingsDto } from "@power-leads/shared";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { SettingsModel, type SettingsDocumentShape } from "../models/settings.js";
import { getSettings } from "../services/settings.js";
import type { HydratedDocument } from "mongoose";
import { requireRole } from "../security/auth.js";
import { recordAuditEvent } from "../services/audit.js";

const settingsSchema = z.object({
  icp: z.object({
    industries: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    geographies: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
    exclusions: z.array(z.string().trim().min(1).max(150)).max(100)
  }),
  personas: z.object({
    titles: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
    seniorities: z.array(z.enum(["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern"])).min(1),
    requireVerifiedEmail: z.boolean()
  })
});

export function settingsRouter() {
  const router = Router();

  router.get("/", async (request, response, next) => {
    try {
      const settings = await getSettings(request.actor.workspaceId, request.actor.userId);
      if (!settings) throw new Error("Settings could not be initialized");
      response.json(toSettingsDto(settings));
    } catch (error) {
      next(error);
    }
  });

  router.put("/", requireRole("admin"), async (request, response, next) => {
    try {
      const input = settingsSchema.parse(request.body);
      const settings = await SettingsModel.findOneAndUpdate(
        { workspaceId: request.actor.workspaceId, key: "default" },
        { $set: { ...input, updatedBy: request.actor.userId }, $setOnInsert: { workspaceId: request.actor.workspaceId, key: "default" } },
        { upsert: true, new: true, runValidators: true }
      );
      if (!settings) throw new Error("Settings could not be saved");
      await recordAuditEvent(request, "settings.updated", "settings", settings.id, {});
      response.json(toSettingsDto(settings));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function toSettingsDto(settings: HydratedDocument<SettingsDocumentShape>): SettingsDto {
  return {
    icp: {
      industries: [...settings.icp.industries],
      geographies: [...settings.icp.geographies],
      exclusions: [...settings.icp.exclusions]
    },
    personas: {
      titles: [...settings.personas.titles],
      seniorities: [...settings.personas.seniorities],
      requireVerifiedEmail: settings.personas.requireVerifiedEmail
    },
    integrations: {
      adsMode: env.ADS_API_MODE,
      apolloMode: env.APOLLO_MODE,
      adsCredentialConfigured: Boolean(env.ADS_API_TOKEN),
      apolloCredentialConfigured: Boolean(env.APOLLO_API_KEY),
      geminiMode: env.GEMINI_MODE,
      geminiCredentialConfigured: Boolean(env.GEMINI_API_KEY),
      geminiModel: env.GEMINI_MODEL,
      mailMode: env.MAIL_MODE,
      sendGridCredentialConfigured: Boolean(env.SENDGRID_API_KEY),
      sendGridWebhookConfigured: Boolean(env.SENDGRID_WEBHOOK_PUBLIC_KEY),
      sendGridFromEmail: env.SENDGRID_FROM_EMAIL,
      sendGridFromName: env.SENDGRID_FROM_NAME,
      mailPerRunLimit: env.MAIL_PER_RUN_LIMIT,
      mailDailyWorkspaceLimit: env.MAIL_DAILY_WORKSPACE_LIMIT
    }
  };
}
