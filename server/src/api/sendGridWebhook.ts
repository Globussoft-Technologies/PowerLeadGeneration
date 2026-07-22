import { EventWebhook } from "@sendgrid/eventwebhook";
import type { RequestHandler } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { ContactModel } from "../models/contact.js";
import { MailDeliveryModel } from "../models/mailDelivery.js";
import { MailEventModel } from "../models/mailEvent.js";
import { SuppressionModel, SUPPRESSION_REASONS } from "../models/suppression.js";

const eventSchema = z.object({
  email: z.string().email(),
  event: z.string().min(1).max(50),
  timestamp: z.union([z.number(), z.string()]).transform((value) => Number(value)),
  sg_event_id: z.string().min(1).max(300),
  sg_message_id: z.string().max(300).optional(),
  type: z.string().max(50).optional(),
  reason: z.string().max(1_000).optional(),
  response: z.string().max(1_000).optional(),
  status: z.string().max(50).optional(),
  workspaceId: z.string().max(200).optional(),
  runId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  contactId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  custom_args: z.record(z.string(), z.string()).optional()
}).passthrough();

export const sendGridWebhookHandler: RequestHandler = async (request, response, next) => {
  try {
    if (!env.SENDGRID_WEBHOOK_PUBLIC_KEY) return response.status(503).json({ error: "SendGrid webhook verification is not configured" });
    if (!Buffer.isBuffer(request.body)) return response.status(400).json({ error: "Webhook body must be raw JSON" });
    const signature = request.header("x-twilio-email-event-webhook-signature");
    const timestamp = request.header("x-twilio-email-event-webhook-timestamp");
    if (!signature || !timestamp) return response.status(401).json({ error: "Missing webhook signature" });
    const timestampSeconds = Number(timestamp);
    if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > env.SENDGRID_WEBHOOK_MAX_AGE_SECONDS) {
      return response.status(401).json({ error: "Expired webhook signature" });
    }
    const verifier = new EventWebhook();
    const publicKey = verifier.convertPublicKeyToECDSA(env.SENDGRID_WEBHOOK_PUBLIC_KEY);
    if (!verifier.verifySignature(publicKey, request.body, signature, timestamp)) {
      return response.status(401).json({ error: "Invalid webhook signature" });
    }
    const events = z.array(eventSchema).max(1_000).parse(JSON.parse(request.body.toString("utf8")));
    const result = await processSendGridEvents(events);
    return response.status(202).json(result);
  } catch (error) {
    return next(error);
  }
};

export async function processSendGridEvents(events: Array<z.infer<typeof eventSchema>>) {
  let accepted = 0;
  let duplicates = 0;
  for (const event of events) {
    const custom = event.custom_args ?? {};
    const workspaceId = event.workspaceId ?? custom.workspaceId;
    const runId = event.runId ?? custom.runId;
    const contactId = event.contactId ?? custom.contactId;
    if (!workspaceId) continue;
    try {
      await MailEventModel.create({
        providerEventId: event.sg_event_id,
        workspaceId,
        runId,
        contactId,
        providerMessageId: event.sg_message_id,
        email: event.email,
        event: event.event,
        eventType: event.type,
        occurredAt: new Date(event.timestamp * 1000),
        reason: event.reason ?? event.response,
        status: event.status
      });
    } catch (error) {
      if (isDuplicateKey(error)) { duplicates += 1; continue; }
      throw error;
    }
    accepted += 1;
    const status = deliveryStatus(event.event, event.type);
    await MailDeliveryModel.findOneAndUpdate(
      {
        workspaceId,
        ...(runId && contactId ? { runId, contactId } : event.sg_message_id ? { providerMessageId: event.sg_message_id } : { recipientEmail: event.email })
      },
      { $set: { status, lastEventAt: new Date(event.timestamp * 1000), error: event.reason ?? event.response } },
      { sort: { createdAt: -1 } }
    );
    if (contactId && ["bounced", "dropped", "spamreport", "unsubscribed"].includes(status)) {
      await ContactModel.updateOne({ _id: contactId, workspaceId }, { enrollmentStatus: "failed" });
    }
    const suppressionReason = suppressionReasonFor(event.event, event.type);
    if (suppressionReason) {
      await SuppressionModel.updateOne(
        { workspaceId, email: event.email.toLowerCase() },
        { $set: { reason: suppressionReason, source: "sendgrid_webhook", providerEventId: event.sg_event_id, suppressedAt: new Date(event.timestamp * 1000) } },
        { upsert: true }
      );
    }
  }
  return { accepted, duplicates };
}

function deliveryStatus(event: string, type?: string) {
  if (event === "bounce") return type === "blocked" ? "deferred" : "bounced";
  if (event === "spamreport") return "spamreport";
  if (["unsubscribe", "group_unsubscribe"].includes(event)) return "unsubscribed";
  if (event === "drop" || event === "dropped") return "dropped";
  if (["processed", "delivered", "deferred"].includes(event)) return event;
  return "accepted";
}

function suppressionReasonFor(event: string, type?: string) {
  if (event === "bounce" && type === "blocked") return null;
  const candidate = event === "bounce" ? "bounce" : event === "drop" ? "dropped" : event;
  return (SUPPRESSION_REASONS as readonly string[]).includes(candidate) ? candidate as typeof SUPPRESSION_REASONS[number] : null;
}

function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}
