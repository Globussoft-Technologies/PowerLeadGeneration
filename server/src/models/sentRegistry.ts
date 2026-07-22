import { Schema, Types, model } from "mongoose";

export type SentRegistryStatus = "sending" | "sent" | "failed";

export type SentRegistryDocumentShape = {
  workspaceId: string;
  email: string;
  runId: Types.ObjectId;
  contactId: Types.ObjectId;
  status: SentRegistryStatus;
  mailMessageId?: string;
  subject?: string;
  sentAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
};

const sentRegistrySchema = new Schema<SentRegistryDocumentShape>(
  {
    workspaceId: { type: String, required: true, trim: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    runId: { type: Schema.Types.ObjectId, ref: "Run", required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    status: { type: String, enum: ["sending", "sent", "failed"], required: true, index: true },
    mailMessageId: String,
    subject: String,
    sentAt: Date,
    error: String
  },
  { timestamps: true }
);

sentRegistrySchema.index({ workspaceId: 1, email: 1 }, { unique: true });

export const SentRegistryModel = model<SentRegistryDocumentShape>("SentRegistry", sentRegistrySchema);
