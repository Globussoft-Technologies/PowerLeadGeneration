import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MailDeliveryModel } from "../models/mailDelivery.js";
import { MailEventModel } from "../models/mailEvent.js";
import { SuppressionModel } from "../models/suppression.js";
import { processSendGridEvents } from "./sendGridWebhook.js";

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

beforeEach(async () => { await mongoose.connection.db?.dropDatabase(); });

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

describe("SendGrid event processing", () => {
  it("stores events idempotently, updates delivery, and suppresses hard bounces", async () => {
    const runId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    await MailDeliveryModel.create({
      workspaceId: "workspace-a", runId, contactId, recipientEmail: "person@example.com", recipientName: "Person",
      senderEmail: "sender@example.com", senderName: "Power Leads", subject: "Hello", textBody: "Hello", htmlBody: "Hello",
      provider: "sendgrid", providerMessageId: "message-1", status: "accepted"
    });
    const event = {
      email: "person@example.com", event: "bounce", type: "bounce", timestamp: 1_786_000_000,
      sg_event_id: "event-1", sg_message_id: "message-1", workspaceId: "workspace-a", runId: runId.toString(), contactId: contactId.toString(),
      reason: "invalid recipient"
    };

    expect(await processSendGridEvents([event])).toEqual({ accepted: 1, duplicates: 0 });
    expect(await processSendGridEvents([event])).toEqual({ accepted: 0, duplicates: 1 });
    expect(await MailEventModel.countDocuments()).toBe(1);
    expect((await MailDeliveryModel.findOne())?.status).toBe("bounced");
    expect(await SuppressionModel.findOne({ workspaceId: "workspace-a", email: "person@example.com" })).toMatchObject({ reason: "bounce" });
  });

  it("treats blocked bounces as temporary and does not suppress the recipient", async () => {
    await processSendGridEvents([{
      email: "person@example.com", event: "bounce", type: "blocked", timestamp: 1_786_000_000,
      sg_event_id: "event-2", workspaceId: "workspace-a", reason: "temporary block"
    }]);
    expect(await SuppressionModel.countDocuments()).toBe(0);
  });
});
