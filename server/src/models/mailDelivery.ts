import { Schema, Types, model } from "mongoose";

const mailDeliverySchema = new Schema({
  workspaceId: { type: String, required: true, trim: true, index: true },
  runId: { type: Schema.Types.ObjectId, ref: "Run", required: true, index: true },
  contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true, index: true },
  recipientEmail: { type: String, required: true, lowercase: true, trim: true },
  recipientName: String,
  senderEmail: { type: String, required: true },
  senderName: { type: String, required: true },
  subject: { type: String, required: true },
  textBody: { type: String, required: true },
  htmlBody: { type: String, required: true },
  provider: { type: String, enum: ["sendgrid", "mock"], required: true },
  providerMessageId: String,
  status: { type: String, enum: ["sending", "accepted", "processed", "delivered", "deferred", "bounced", "dropped", "spamreport", "unsubscribed", "failed"], required: true, index: true },
  lastEventAt: Date,
  sentAt: Date,
  error: String
}, { timestamps: true });

mailDeliverySchema.index({ workspaceId: 1, runId: 1, contactId: 1 }, { unique: true });
mailDeliverySchema.index({ workspaceId: 1, recipientEmail: 1, createdAt: -1 });

export const MailDeliveryModel = model("MailDelivery", mailDeliverySchema);
