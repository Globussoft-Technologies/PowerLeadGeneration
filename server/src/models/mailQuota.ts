import { Schema, model } from "mongoose";

const mailQuotaSchema = new Schema({
  workspaceId: { type: String, required: true, trim: true, index: true },
  scope: { type: String, enum: ["run", "day"], required: true },
  key: { type: String, required: true },
  count: { type: Number, required: true, default: 0 }
}, { timestamps: true });

mailQuotaSchema.index({ workspaceId: 1, scope: 1, key: 1 }, { unique: true });

export const MailQuotaModel = model("MailQuota", mailQuotaSchema);
