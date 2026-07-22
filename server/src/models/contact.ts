import type { EnrollmentStatus } from "@power-leads/shared";
import { Schema, Types, model } from "mongoose";

export type ContactDocumentShape = {
  workspaceId: string;
  runId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  title: string;
  email?: string;
  personalEmails: string[];
  emailVerified: boolean;
  linkedinUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  githubUrl?: string;
  phoneNumbers: Array<{ number: string; type?: string; status?: string; source?: string }>;
  seniority?: string;
  apolloId: string;
  mailMessageId?: string;
  sentAt?: Date;
  enrollmentStatus: EnrollmentStatus;
  tags: {
    source: "power_leads" | "ad_signal";
    adPlatform: string;
    adSeenDate?: Date;
    adSnippet?: string;
    personalization?: string;
  };
};

const tagsSchema = new Schema<ContactDocumentShape["tags"]>(
  {
    source: { type: String, enum: ["power_leads", "ad_signal"], default: "power_leads" },
    adPlatform: { type: String, required: true },
    adSeenDate: Date,
    adSnippet: String,
    personalization: String
  },
  { _id: false }
);

const contactSchema = new Schema<ContactDocumentShape>(
  {
    workspaceId: { type: String, required: true, trim: true, index: true },
    runId: { type: Schema.Types.ObjectId, ref: "Run", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    personalEmails: { type: [String], default: [] },
    emailVerified: { type: Boolean, default: false },
    linkedinUrl: String,
    twitterUrl: String,
    facebookUrl: String,
    githubUrl: String,
    phoneNumbers: {
      type: [{
        number: { type: String, required: true },
        type: String,
        status: String,
        source: String,
        _id: false
      }],
      default: []
    },
    seniority: String,
    apolloId: { type: String, required: true },
    mailMessageId: String,
    sentAt: Date,
    enrollmentStatus: {
      type: String,
      enum: ["pending", "approved", "rejected", "sent", "enrolled", "skipped", "failed"],
      default: "pending",
      index: true
    },
    tags: { type: tagsSchema, required: true }
  },
  { timestamps: true }
);

contactSchema.index({ workspaceId: 1, runId: 1, apolloId: 1 }, { unique: true });

export const ContactModel = model<ContactDocumentShape>("Contact", contactSchema);
