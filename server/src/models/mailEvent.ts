import { Schema, model } from "mongoose";

const mailEventSchema = new Schema({
  providerEventId: { type: String, required: true, unique: true, index: true },
  workspaceId: { type: String, required: true, trim: true, index: true },
  runId: { type: Schema.Types.ObjectId, ref: "Run", index: true },
  contactId: { type: Schema.Types.ObjectId, ref: "Contact", index: true },
  providerMessageId: String,
  email: { type: String, required: true, lowercase: true, trim: true },
  event: { type: String, required: true },
  eventType: String,
  occurredAt: { type: Date, required: true },
  reason: String,
  status: String
}, { timestamps: true });

export const MailEventModel = model("MailEvent", mailEventSchema);
