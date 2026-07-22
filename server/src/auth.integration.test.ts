import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import type { AdsClient } from "./integrations/adsApi.js";
import type { ApolloClient } from "./integrations/apollo.js";
import type { MailClient, MailMessage } from "./integrations/sendGrid.js";
import { AuditEventModel } from "./models/auditEvent.js";
import { RunModel } from "./models/run.js";
import { UserModel } from "./models/user.js";
import { hashPassword } from "./services/auth.js";

const adsClient: AdsClient = { fetchAll: async () => [] };
const apolloClient: ApolloClient = { searchPeople: async () => [], enrichPerson: async () => null };
const sentMail: MailMessage[] = [];
const mailClient: MailClient = { send: async (message) => { sentMail.push(message); return { messageId: `test-${sentMail.length}` }; } };
let mongo: MongoMemoryServer;
const originalAuthMode = env.AUTH_MODE;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  env.AUTH_MODE = "password";
});

beforeEach(async () => {
  sentMail.length = 0;
  await mongoose.connection.db?.dropDatabase();
});

afterAll(async () => {
  env.AUTH_MODE = originalAuthMode;
  await mongoose.disconnect();
  await mongo.stop();
});

describe("password authentication and user administration", () => {
  it("logs in, persists a session, and enforces CSRF", async () => {
    await createUser("admin@example.com", "workspace-a", "admin");
    const agent = request.agent(createApp(adsClient, apolloClient, undefined, mailClient));
    const login = await agent.post("/api/auth/login").send({ email: "admin@example.com", password: "ValidPassword123" });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("admin");

    const session = await agent.get("/api/auth/session");
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe("admin@example.com");

    const withoutCsrf = await agent.put("/api/settings").send({});
    expect(withoutCsrf.status).toBe(403);
    expect(withoutCsrf.body.error).toBe("Invalid CSRF token");
    expect((await agent.get("/api/ready")).status).toBe(200);
    expect((await agent.post("/api/auth/logout").set("x-csrf-token", login.body.csrfToken)).status).toBe(204);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
  });

  it("invites a reviewer and activates the account through the invitation link", async () => {
    await createUser("admin@example.com", "workspace-a", "admin");
    const admin = request.agent(createApp(adsClient, apolloClient, undefined, mailClient));
    const login = await admin.post("/api/auth/login").send({ email: "admin@example.com", password: "ValidPassword123" });
    const invite = await admin.post("/api/users/invitations").set("x-csrf-token", login.body.csrfToken).send({ email: "reviewer@example.com", name: "Review User", role: "reviewer" });
    expect(invite.status).toBe(201);
    expect(sentMail).toHaveLength(1);
    const token = tokenFromMail(sentMail[0]!.text, "accept-invite");

    const reviewer = request.agent(createApp(adsClient, apolloClient, undefined, mailClient));
    const accepted = await reviewer.post("/api/auth/accept-invite").send({ token, name: "Review User", password: "AnotherPassword123" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user.role).toBe("reviewer");
    const forbidden = await reviewer.post("/api/runs").set("x-csrf-token", accepted.body.csrfToken).send({});
    expect(forbidden.status).toBe(403);
    const promoted = await admin.patch(`/api/users/${accepted.body.user.id}`).set("x-csrf-token", login.body.csrfToken).send({ role: "operator" });
    expect(promoted.status).toBe(200);
    expect(promoted.body.role).toBe("operator");
    const disabled = await admin.patch(`/api/users/${accepted.body.user.id}`).set("x-csrf-token", login.body.csrfToken).send({ status: "disabled" });
    expect(disabled.status).toBe(200);
    expect((await reviewer.get("/api/auth/session")).status).toBe(401);
  });

  it("changes a password and rotates the current session", async () => {
    await createUser("change@example.com", "workspace-a", "operator");
    const app = createApp(adsClient, apolloClient, undefined, mailClient);
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").send({ email: "change@example.com", password: "ValidPassword123" });
    const changed = await agent.post("/api/auth/change-password").set("x-csrf-token", login.body.csrfToken).send({ currentPassword: "ValidPassword123", newPassword: "ChangedPassword123" });
    expect(changed.status).toBe(200);
    expect(changed.body.csrfToken).not.toBe(login.body.csrfToken);
    expect((await agent.get("/api/auth/session")).status).toBe(200);
    expect((await request(app).post("/api/auth/login").send({ email: "change@example.com", password: "ValidPassword123" })).status).toBe(401);
  });

  it("resets a password and invalidates existing sessions", async () => {
    await createUser("operator@example.com", "workspace-a", "operator");
    const app = createApp(adsClient, apolloClient, undefined, mailClient);
    const agent = request.agent(app);
    expect((await agent.post("/api/auth/login").send({ email: "operator@example.com", password: "ValidPassword123" })).status).toBe(200);
    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: "operator@example.com" });
    expect(forgot.status).toBe(200);
    const token = tokenFromMail(sentMail[0]!.text, "reset-password");
    const reset = await request(app).post("/api/auth/reset-password").send({ token, password: "NewValidPassword123" });
    expect(reset.status).toBe(200);
    expect((await agent.get("/api/auth/session")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "operator@example.com", password: "NewValidPassword123" })).status).toBe(200);
  });

  it("isolates users, runs, and audit events by workspace", async () => {
    const adminA = await createUser("a@example.com", "workspace-a", "admin");
    await createUser("b@example.com", "workspace-b", "admin");
    await RunModel.create({ workspaceId: "workspace-a", createdBy: adminA.id, status: "done", reviewRequired: true, filters: { keyword: "private-a", industry: "", category: "", geography: "", platform: "facebook", minDaysActive: 0, pageSize: 100 }, stats: { adsReturned: 1, discovered: 1, qualified: 0, enriched: 0, approved: 0, sent: 0, enrolled: 0, skipped: 1 } });
    const app = createApp(adsClient, apolloClient, undefined, mailClient);
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    await agentA.post("/api/auth/login").send({ email: "a@example.com", password: "ValidPassword123" });
    await agentB.post("/api/auth/login").send({ email: "b@example.com", password: "ValidPassword123" });
    expect((await agentA.get("/api/runs")).body).toHaveLength(1);
    expect((await agentB.get("/api/runs")).body).toHaveLength(0);
    expect((await agentA.get("/api/users")).body).toHaveLength(1);
    expect((await agentB.get("/api/users")).body).toHaveLength(1);
    expect(await AuditEventModel.countDocuments({ action: "auth.login" })).toBe(2);
  });
});

async function createUser(email: string, workspaceId: string, role: "admin" | "operator" | "reviewer") {
  return UserModel.create({ workspaceId, email, name: email.split("@")[0], passwordHash: await hashPassword("ValidPassword123"), role, status: "active" });
}

function tokenFromMail(text: string, route: string) {
  const match = text.match(new RegExp(`#${route}\\?token=([^\\s]+)`));
  if (!match?.[1]) throw new Error(`No ${route} token in mail`);
  return decodeURIComponent(match[1]);
}
