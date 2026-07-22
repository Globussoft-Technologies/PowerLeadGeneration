import { env } from "../config/env.js";
import { connectDatabase, disconnectDatabase } from "../db/connection.js";
import { UserModel } from "../models/user.js";
import { hashPassword, validatePassword } from "../services/auth.js";

if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) {
  throw new Error("Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before running create-admin");
}
const passwordError = validatePassword(env.BOOTSTRAP_ADMIN_PASSWORD);
if (passwordError) throw new Error(passwordError);

await connectDatabase();
try {
  if (await UserModel.exists({ email: env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase() })) {
    throw new Error("A user already exists for BOOTSTRAP_ADMIN_EMAIL");
  }
  const user = await UserModel.create({
    workspaceId: env.DEV_AUTH_WORKSPACE_ID,
    email: env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(),
    name: env.BOOTSTRAP_ADMIN_NAME,
    passwordHash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
    role: "admin",
    status: "active"
  });
  console.log(`Created admin ${user.email} in workspace ${user.workspaceId}. Remove BOOTSTRAP_ADMIN_PASSWORD from the environment now.`);
} finally {
  await disconnectDatabase();
}
