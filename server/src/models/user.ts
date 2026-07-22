import { Schema, model } from "mongoose";
import type { Role } from "../security/auth.js";

export type UserStatus = "active" | "disabled";

export type UserDocumentShape = {
  workspaceId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const userSchema = new Schema<UserDocumentShape>({
  workspaceId: { type: String, required: true, trim: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  name: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["admin", "operator", "reviewer"], required: true },
  status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
  lastLoginAt: Date
}, { timestamps: true });

userSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

export const UserModel = model<UserDocumentShape>("User", userSchema);
