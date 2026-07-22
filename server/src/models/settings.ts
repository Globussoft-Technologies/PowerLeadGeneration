import { Schema, model } from "mongoose";

export type SettingsDocumentShape = {
  workspaceId: string;
  updatedBy: string;
  key: "default";
  icp: {
    industries: string[];
    geographies: string[];
    exclusions: string[];
  };
  personas: {
    titles: string[];
    seniorities: string[];
    requireVerifiedEmail: boolean;
  };
};

const settingsSchema = new Schema<SettingsDocumentShape>(
  {
    workspaceId: { type: String, required: true, trim: true, index: true },
    updatedBy: { type: String, required: true, trim: true },
    key: { type: String, enum: ["default"], required: true },
    icp: {
      industries: { type: [String], required: true },
      geographies: { type: [String], required: true },
      exclusions: { type: [String], required: true }
    },
    personas: {
      titles: { type: [String], required: true },
      seniorities: { type: [String], required: true },
      requireVerifiedEmail: { type: Boolean, required: true }
    }
  },
  { timestamps: true }
);

settingsSchema.index({ workspaceId: 1, key: 1 }, { unique: true });

export const SettingsModel = model<SettingsDocumentShape>("Settings", settingsSchema);
