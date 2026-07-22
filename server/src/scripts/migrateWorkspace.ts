import { env } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../db/connection.js";
import { CompanyModel } from "../models/company.js";
import { ContactModel } from "../models/contact.js";
import { RunModel } from "../models/run.js";
import { SentRegistryModel } from "../models/sentRegistry.js";
import { SettingsModel } from "../models/settings.js";
import { MailDeliveryModel } from "../models/mailDelivery.js";
import { MailEventModel } from "../models/mailEvent.js";
import { SuppressionModel } from "../models/suppression.js";
import { MailQuotaModel } from "../models/mailQuota.js";

const workspaceId = env.DEV_AUTH_WORKSPACE_ID;
const userId = env.DEV_AUTH_USER_ID;

await connectDatabase();

try {
  const runs = await RunModel.collection.updateMany(
    { workspaceId: { $exists: false } },
    { $set: { workspaceId, createdBy: userId } }
  );
  const companies = await CompanyModel.collection.updateMany(
    { workspaceId: { $exists: false } },
    { $set: { workspaceId } }
  );
  const contacts = await ContactModel.collection.updateMany(
    { workspaceId: { $exists: false } },
    { $set: { workspaceId } }
  );
  const settings = await SettingsModel.collection.updateMany(
    { workspaceId: { $exists: false } },
    { $set: { workspaceId, updatedBy: userId } }
  );
  const sentRegistry = await SentRegistryModel.collection.updateMany(
    { workspaceId: { $exists: false } },
    { $set: { workspaceId } }
  );

  await Promise.all([
    RunModel.syncIndexes(),
    CompanyModel.syncIndexes(),
    ContactModel.syncIndexes(),
    SettingsModel.syncIndexes(),
    SentRegistryModel.syncIndexes(),
    MailDeliveryModel.syncIndexes(),
    MailEventModel.syncIndexes(),
    SuppressionModel.syncIndexes(),
    MailQuotaModel.syncIndexes()
  ]);

  console.log(JSON.stringify({
    workspaceId,
    migrated: {
      runs: runs.modifiedCount,
      companies: companies.modifiedCount,
      contacts: contacts.modifiedCount,
      settings: settings.modifiedCount,
      sentRegistry: sentRegistry.modifiedCount
    }
  }, null, 2));
} finally {
  await disconnectDatabase();
}
