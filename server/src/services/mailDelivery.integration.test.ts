import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MailClient, MailMessage } from "../integrations/sendGrid.js";
import { CompanyModel } from "../models/company.js";
import { ContactModel } from "../models/contact.js";
import { MailDeliveryModel } from "../models/mailDelivery.js";
import { RunModel } from "../models/run.js";
import { SuppressionModel } from "../models/suppression.js";
import { sendApprovedMail } from "./mailDelivery.js";
import { reserveMailQuota } from "./mailQuota.js";
import { env } from "../config/env.js";

let mongo: MongoMemoryServer;
const originalRunLimit = env.MAIL_PER_RUN_LIMIT;
const originalDailyLimit = env.MAIL_DAILY_WORKSPACE_LIMIT;
beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
beforeEach(async () => { await mongoose.connection.db?.dropDatabase(); });
afterAll(async () => { env.MAIL_PER_RUN_LIMIT = originalRunLimit; env.MAIL_DAILY_WORKSPACE_LIMIT = originalDailyLimit; await mongoose.disconnect(); await mongo.stop(); });

describe("production mail safeguards", () => {
  it("skips suppressed recipients and preserves the exact rendered message", async () => {
    const run = await RunModel.create({
      workspaceId: "workspace-a", createdBy: "operator-a", status: "done", reviewRequired: true,
      filters: { keyword: "test", category: "", industry: "", geography: "", platform: "facebook", minDaysActive: 0, pageSize: 100 },
      stats: { discovered: 1, qualified: 1, enriched: 2, approved: 2, sent: 0, enrolled: 0, skipped: 0 }
    });
    const company = await CompanyModel.create({ workspaceId: "workspace-a", runId: run._id, name: "Acme", domain: "acme.example", adPlatforms: ["meta"], icpMatch: true, icpReason: "Fit", status: "enriched" });
    const contacts = await ContactModel.create([
      contact(run._id, company._id, "allowed", "Allowed Person", "allowed@example.com"),
      contact(run._id, company._id, "blocked", "Blocked Person", "blocked@example.com")
    ]);
    await SuppressionModel.create({ workspaceId: "workspace-a", email: "blocked@example.com", reason: "unsubscribe", source: "manual" });
    const sent: MailMessage[] = [];
    const mailClient: MailClient = { send: async (message) => { sent.push(message); return { messageId: "provider-1" }; } };

    const result = await sendApprovedMail(run.id, "workspace-a", { subject: "Hello {{companyName}}", body: "Hi {{firstName}}" }, mailClient);

    expect(result).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.customArgs.workspaceId).toBe("workspace-a");
    expect(await MailDeliveryModel.findOne({ contactId: contacts[0]!._id })).toMatchObject({ subject: "Hello Acme", textBody: "Hi Allowed", providerMessageId: "provider-1", status: "accepted" });
    expect((await ContactModel.findById(contacts[1]!._id))?.enrollmentStatus).toBe("approved");
  });

  it("reserves mail ceilings atomically across concurrent requests", async () => {
    env.MAIL_PER_RUN_LIMIT = 2;
    env.MAIL_DAILY_WORKSPACE_LIMIT = 2;
    const results = await Promise.allSettled([
      reserveMailQuota("workspace-a", new Types.ObjectId().toString(), 2),
      reserveMailQuota("workspace-a", new Types.ObjectId().toString(), 2)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    env.MAIL_PER_RUN_LIMIT = originalRunLimit;
    env.MAIL_DAILY_WORKSPACE_LIMIT = originalDailyLimit;
  });
});

function contact(runId: Types.ObjectId, companyId: Types.ObjectId, apolloId: string, name: string, email: string) {
  return { workspaceId: "workspace-a", runId, companyId, name, title: "CMO", email, emailVerified: true, apolloId, enrollmentStatus: "approved", tags: { source: "power_leads", adPlatform: "meta" } };
}
