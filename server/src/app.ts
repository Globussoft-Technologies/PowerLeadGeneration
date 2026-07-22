import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { categoriesRouter } from "./api/categories.js";
import { auditRouter } from "./api/audit.js";
import { authRouter } from "./api/auth.js";
import { usersRouter } from "./api/users.js";
import { contactsRouter } from "./api/contacts.js";
import { runsRouter } from "./api/runs.js";
import { settingsRouter } from "./api/settings.js";
import { databaseState } from "./db/connection.js";
import type { AdsClient } from "./integrations/adsApi.js";
import type { ApolloClient } from "./integrations/apollo.js";
import { createGeminiClient, type GeminiClient } from "./integrations/gemini.js";
import { createMailClient, type MailClient } from "./integrations/sendGrid.js";
import { env } from "./config/env.js";
import { authenticateRequest, requireCsrf } from "./security/auth.js";
import { requestContext } from "./security/requestContext.js";
import { sendGridWebhookHandler } from "./api/sendGridWebhook.js";
import { apolloWebhookHandler } from "./api/apolloWebhook.js";

export function createApp(adsClient: AdsClient, apolloClient: ApolloClient, geminiClient: GeminiClient = createGeminiClient(), mailClient: MailClient = createMailClient()) {
  const app = express();

  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  app.use(requestContext);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.post("/api/webhooks/sendgrid", express.raw({ type: "application/json", limit: "1mb" }), sendGridWebhookHandler);
  app.post("/api/webhooks/apollo", express.json({ limit: "1mb" }), apolloWebhookHandler);
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "power-leads-server",
      database: databaseState(),
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/ready", (_request, response) => {
    const database = databaseState();
    response.status(database === "connected" ? 200 : 503).json({
      status: database === "connected" ? "ready" : "not_ready",
      service: "power-leads-server",
      database,
      timestamp: new Date().toISOString()
    });
  });

  app.use("/api", rateLimit({
    windowMs: 60_000,
    limit: env.API_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false
  }));
  app.use("/api/auth", rateLimit({
    windowMs: 15 * 60_000,
    limit: 50,
    standardHeaders: "draft-8",
    legacyHeaders: false
  }), authRouter(mailClient));
  app.use("/api", authenticateRequest);
  app.use("/api", requireCsrf);

  app.get("/api/session", (request, response) => {
    response.json({
      userId: request.actor.userId,
      workspaceId: request.actor.workspaceId,
      role: request.actor.role
    });
  });

  app.use("/api/runs", runsRouter(adsClient, apolloClient, geminiClient, mailClient));
  app.use("/api/contacts", contactsRouter());
  app.use("/api/settings", settingsRouter());
  app.use("/api/categories", categoriesRouter());
  app.use("/api/audit", auditRouter());
  app.use("/api/users", usersRouter(mailClient));

  app.use((_request, response) => {
    response.status(404).json({ error: "Not found" });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "Invalid request", issues: error.flatten() });
      return;
    }

    console.error(`[request:${_request.requestId}]`, error);
    response.status(500).json({ error: "Internal server error" });
  });

  return app;
}
