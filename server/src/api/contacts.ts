import type { ContactDto } from "@power-leads/shared";
import { Router } from "express";
import { z } from "zod";
import { ContactModel, type ContactDocumentShape } from "../models/contact.js";
import { RunModel } from "../models/run.js";
import { objectId } from "../pipeline/orchestrator.js";
import type { HydratedDocument } from "mongoose";
import { requireRole } from "../security/auth.js";
import { recordAuditEvent } from "../services/audit.js";

const decisionSchema = z.object({
  enrollmentStatus: z.enum(["approved", "rejected"])
});

export function contactsRouter() {
  const router = Router();

  router.patch("/:contactId", requireRole("admin", "operator", "reviewer"), async (request, response, next) => {
    try {
      const contactId = objectId(request.params.contactId);
      if (!contactId) return response.status(400).json({ error: "Invalid contact ID" });
      const input = decisionSchema.parse(request.body);

      const contact = await ContactModel.findOneAndUpdate(
        { _id: contactId, workspaceId: request.actor.workspaceId },
        { enrollmentStatus: input.enrollmentStatus },
        { new: true }
      );
      if (!contact) return response.status(404).json({ error: "Contact not found" });

      const [approved, pending] = await Promise.all([
        ContactModel.countDocuments({ runId: contact.runId, workspaceId: request.actor.workspaceId, enrollmentStatus: { $in: ["approved", "sent"] } }),
        ContactModel.countDocuments({ runId: contact.runId, workspaceId: request.actor.workspaceId, enrollmentStatus: "pending" })
      ]);
      await RunModel.updateOne(
        { _id: contact.runId, workspaceId: request.actor.workspaceId },
        { "stats.approved": approved, status: pending === 0 ? "done" : "pending_review" }
      );
      await recordAuditEvent(request, "contact.decision", "contact", contact.id, { enrollmentStatus: input.enrollmentStatus, runId: contact.runId.toString() });
      return response.json(toContactDto(contact));
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export function toContactDto(contact: HydratedDocument<ContactDocumentShape>): ContactDto {
  return {
    id: contact.id,
    runId: contact.runId.toString(),
    companyId: contact.companyId.toString(),
    name: contact.name,
    title: contact.title,
    email: contact.email,
    personalEmails: contact.personalEmails ?? [],
    emailVerified: contact.emailVerified,
    linkedinUrl: contact.linkedinUrl,
    twitterUrl: contact.twitterUrl,
    facebookUrl: contact.facebookUrl,
    githubUrl: contact.githubUrl,
    phoneNumbers: contact.phoneNumbers ?? [],
    seniority: contact.seniority,
      apolloId: contact.apolloId,
      mailMessageId: contact.mailMessageId,
      sentAt: contact.sentAt?.toISOString(),
    enrollmentStatus: contact.enrollmentStatus,
    tags: {
      source: "power_leads",
      adPlatform: contact.tags.adPlatform,
      adSeenDate: contact.tags.adSeenDate?.toISOString(),
      adSnippet: contact.tags.adSnippet,
      personalization: contact.tags.personalization
    }
  };
}
