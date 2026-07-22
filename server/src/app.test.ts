import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import type { AdsClient } from "./integrations/adsApi.js";
import type { ApolloClient } from "./integrations/apollo.js";

const adsClient: AdsClient = { fetchAll: async () => [] };
const apolloClient: ApolloClient = { searchPeople: async () => [], enrichPerson: async () => null };
const originalAuthMode = env.AUTH_MODE;

beforeAll(() => { env.AUTH_MODE = "development"; });
afterAll(() => { env.AUTH_MODE = originalAuthMode; });

describe("application", () => {
  it("reports service and database health", async () => {
    const response = await request(createApp(adsClient, apolloClient)).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", service: "power-leads-server" });
    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("reports not-ready while the database is disconnected", async () => {
    const response = await request(createApp(adsClient, apolloClient)).get("/api/ready");
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ status: "not_ready", database: "disconnected" });
  });

  it("rejects invalid development identities", async () => {
    const response = await request(createApp(adsClient, apolloClient))
      .get("/api/categories")
      .set("x-user-role", "owner");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Invalid development identity" });
  });

  it("exposes the authenticated request context", async () => {
    const response = await request(createApp(adsClient, apolloClient))
      .get("/api/session")
      .set("x-user-id", "reviewer-7")
      .set("x-workspace-id", "workspace-2")
      .set("x-user-role", "reviewer");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: "reviewer-7", workspaceId: "workspace-2", role: "reviewer" });
  });

  it("prevents reviewers from starting runs", async () => {
    const response = await request(createApp(adsClient, apolloClient))
      .post("/api/runs")
      .set("x-user-role", "reviewer")
      .send({});
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Insufficient permissions" });
  });

  it("restricts settings changes and audit history to admins", async () => {
    const app = createApp(adsClient, apolloClient);
    const settingsResponse = await request(app).put("/api/settings").set("x-user-role", "operator").send({});
    const auditResponse = await request(app).get("/api/audit").set("x-user-role", "reviewer");
    expect(settingsResponse.status).toBe(403);
    expect(auditResponse.status).toBe(403);
  });

  it("returns JSON for unknown routes", async () => {
    const response = await request(createApp(adsClient, apolloClient)).get("/not-found");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });

  it("rejects malformed contact identifiers before querying the database", async () => {
    const response = await request(createApp(adsClient, apolloClient))
      .patch("/api/contacts/not-an-id")
      .send({ enrollmentStatus: "approved" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid contact ID" });
  });

  it("validates settings before writing them", async () => {
    const response = await request(createApp(adsClient, apolloClient))
      .put("/api/settings")
      .send({ icp: { industries: [] } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("serves the category catalog without exposing the source file", async () => {
    const response = await request(createApp(adsClient, apolloClient)).get("/api/categories");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(45);
    expect(response.body.find((category: { title: string }) => category.title === "Alcohol").industries[0].title).toBe("Bars");
  });

  it("rejects category values outside the catalog", async () => {
    const response = await request(createApp(adsClient, apolloClient)).post("/api/runs").send({
      filters: { category: "Not a real category", industry: "", platform: "facebook", minDaysActive: 30, pageSize: 100 },
      reviewRequired: true
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request");
  });

  it("rejects malformed run identifiers before attempting deletion", async () => {
    const response = await request(createApp(adsClient, apolloClient)).delete("/api/runs/not-an-id");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid run ID" });
  });

  it("rejects malformed run identifiers before attempting mail delivery", async () => {
    const response = await request(createApp(adsClient, apolloClient))
      .post("/api/runs/not-an-id/send")
      .send({ subject: "Hello", body: "Hi {{firstName}}" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid run ID" });
  });
});
