import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./db/connection.js";
import { createAdsClient } from "./integrations/adsApi.js";
import { createApolloClient } from "./integrations/apollo.js";
import { createGeminiClient } from "./integrations/gemini.js";
import { createMailClient } from "./integrations/sendGrid.js";

await connectDatabase();
const app = createApp(createAdsClient(), createApolloClient(), createGeminiClient(), createMailClient());

const server = app.listen(env.PORT, () => {
  console.log(`Power Leads server listening on http://localhost:${env.PORT} (${env.ADS_API_MODE} ads, ${env.APOLLO_MODE} Apollo, ${env.GEMINI_MODE} Gemini, ${env.MAIL_MODE} SendGrid)`);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received; shutting down gracefully`);
  const forced = setTimeout(() => {
    console.error("Graceful shutdown timed out");
    process.exit(1);
  }, 10_000);
  forced.unref();
  server.close(async (error) => {
    try {
      await disconnectDatabase();
      if (error) throw error;
      clearTimeout(forced);
      process.exit(0);
    } catch (shutdownError) {
      console.error("Shutdown failed", shutdownError);
      process.exit(1);
    }
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
