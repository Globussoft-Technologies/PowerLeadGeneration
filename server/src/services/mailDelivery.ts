import type { SendRunMailInput, SendRunMailResult } from "@power-leads/shared";
import pLimit from "p-limit";
import { env } from "../config/env.js";
import type { MailClient } from "../integrations/sendGrid.js";
import { CompanyModel } from "../models/company.js";
import { ContactModel } from "../models/contact.js";
import { RunModel } from "../models/run.js";
import { SentRegistryModel } from "../models/sentRegistry.js";
import { SuppressionModel } from "../models/suppression.js";
import { MailDeliveryModel } from "../models/mailDelivery.js";
import { reserveMailQuota } from "./mailQuota.js";
import { renderMailTemplate, textToHtml } from "./mailTemplate.js";

export async function sendApprovedMail(runId: string, workspaceId: string, input: SendRunMailInput, mailClient: MailClient): Promise<SendRunMailResult> {
  const selectedContacts = await ContactModel.find({
    runId,
    workspaceId,
    enrollmentStatus: "approved",
    email: { $exists: true, $ne: "" },
    ...(input.contactIds?.length ? { _id: { $in: input.contactIds } } : {})
  });
  if (selectedContacts.length === 0) return { sent: 0, skipped: 0, failed: 0, errors: [] };
  const emails = selectedContacts.map((contact) => contact.email?.trim().toLowerCase()).filter((email): email is string => Boolean(email));
  const [suppressions, alreadySent] = await Promise.all([
    SuppressionModel.find({ workspaceId, email: { $in: emails } }).select("email"),
    SentRegistryModel.find({ workspaceId, email: { $in: emails }, status: "sent" }).select("email")
  ]);
  const excluded = new Set([...suppressions, ...alreadySent].map((item) => item.email));
  const contacts = selectedContacts.filter((contact) => contact.email && !excluded.has(contact.email.trim().toLowerCase()));
  const preSkipped = selectedContacts.length - contacts.length;
  if (contacts.length === 0) return { sent: 0, skipped: preSkipped, failed: 0, errors: [] };

  await reserveMailQuota(workspaceId, runId, contacts.length);

  const companyIds = [...new Set(contacts.map((contact) => contact.companyId.toString()))];
  const companies = await CompanyModel.find({ _id: { $in: companyIds }, workspaceId });
  const companiesById = new Map(companies.map((company) => [company.id, company]));
  const limit = pLimit(env.MAIL_CONCURRENCY);

  await RunModel.updateOne({ _id: runId, workspaceId }, { status: "sending" });
  const results = await Promise.all(contacts.map((contact) => limit(async () => {
    const email = contact.email?.trim().toLowerCase();
    if (!email) return { kind: "skipped" as const };
    const company = companiesById.get(contact.companyId.toString());
    if (!company) return { kind: "failed" as const, contactId: contact.id, message: "Company no longer exists" };

    const reserved = await reserveEmail(workspaceId, email, runId, contact.id, input.subject);
    if (!reserved) {
      await ContactModel.updateOne({ _id: contact._id }, { enrollmentStatus: "skipped" });
      return { kind: "skipped" as const };
    }

    try {
      const context = {
        firstName: contact.name.split(/\s+/)[0] || contact.name,
        contactName: contact.name,
        companyName: company.name,
        companyDomain: company.domain,
        personalization: contact.tags.personalization || company.personalization || "I noticed your recent advertising campaign.",
        adSnippet: contact.tags.adSnippet || company.adCreativeSnippet || "",
        senderName: env.SENDGRID_FROM_NAME
      };
      const subject = renderMailTemplate(input.subject, context);
      const text = renderMailTemplate(input.body, context);
      const html = textToHtml(text);
      await MailDeliveryModel.findOneAndUpdate(
        { workspaceId, runId, contactId: contact._id },
        {
          $set: {
            recipientEmail: email,
            recipientName: contact.name,
            senderEmail: env.SENDGRID_FROM_EMAIL ?? "mock@power-leads.local",
            senderName: env.SENDGRID_FROM_NAME,
            subject,
            textBody: text,
            htmlBody: html,
            provider: env.MAIL_MODE === "live" ? "sendgrid" : "mock",
            status: "sending"
          },
          $setOnInsert: { workspaceId, runId, contactId: contact._id }
        },
        { upsert: true }
      );
      const result = await mailClient.send({
        to: email,
        toName: contact.name,
        subject,
        text,
        html,
        customArgs: { source: "power_leads", workspaceId, runId, contactId: contact.id }
      });
      const sentAt = new Date();
      await Promise.all([
        SentRegistryModel.updateOne({ workspaceId, email }, { status: "sent", mailMessageId: result.messageId, subject, sentAt, $unset: { error: 1 } }),
        ContactModel.updateOne({ _id: contact._id }, { enrollmentStatus: "sent", mailMessageId: result.messageId, sentAt }),
        MailDeliveryModel.updateOne(
          { workspaceId, runId, contactId: contact._id },
          { status: "accepted", providerMessageId: result.messageId, sentAt, lastEventAt: sentAt, $unset: { error: 1 } }
        )
      ]);
      return { kind: "sent" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown mail delivery error";
      await SentRegistryModel.updateOne({ workspaceId, email }, { status: "failed", error: message });
      await MailDeliveryModel.updateOne({ workspaceId, runId, contactId: contact._id }, { status: "failed", error: message, lastEventAt: new Date() });
      return { kind: "failed" as const, contactId: contact.id, message };
    }
  })));

  const sent = results.filter((result) => result.kind === "sent").length;
  const skipped = preSkipped + results.filter((result) => result.kind === "skipped").length;
  const errors = results
    .filter((result): result is { kind: "failed"; contactId: string; message: string } => result.kind === "failed")
    .map(({ contactId, message }) => ({ contactId, message }));
  const [pending, totalSent] = await Promise.all([
    ContactModel.countDocuments({ runId, workspaceId, enrollmentStatus: "pending" }),
    ContactModel.countDocuments({ runId, workspaceId, enrollmentStatus: "sent" })
  ]);
  await RunModel.updateOne({ _id: runId, workspaceId }, {
    status: pending > 0 ? "pending_review" : "done",
    "stats.sent": totalSent
  });

  return { sent, skipped, failed: errors.length, errors };
}

async function reserveEmail(workspaceId: string, email: string, runId: string, contactId: string, subject: string) {
  const existing = await SentRegistryModel.findOne({ workspaceId, email });
  if (existing?.status === "sent") return false;
  if (existing?.status === "sending" && Date.now() - existing.updatedAt.getTime() < 15 * 60 * 1000) return false;
  if (existing) {
    await SentRegistryModel.updateOne({ _id: existing._id }, {
      runId,
      contactId,
      status: "sending",
      subject,
      $unset: { error: 1, mailMessageId: 1, sentAt: 1 }
    });
    return true;
  }

  try {
    await SentRegistryModel.create({ workspaceId, email, runId, contactId, status: "sending", subject });
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    throw error;
  }
}

function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}
