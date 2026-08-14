import { buildContainer } from "./container.js";
import { loadSettings } from "./config.js";
import { buildServer } from "./server.js";
import { startTelemetry } from "./telemetry.js";

const settings = loadSettings();
const telemetry = startTelemetry(settings);
const container = await buildContainer(settings);
const server = await buildServer(container);

let closing = false;
async function close(signal: string) {
  if (closing) return;
  closing = true;
  server.log.info({ signal }, "shutdown_started");
  await server.close();
  await container.close();
  await telemetry?.shutdown();
}

process.once("SIGTERM", () => void close("SIGTERM"));
process.once("SIGINT", () => void close("SIGINT"));

try {
  await server.listen({ host: settings.API_HOST, port: settings.API_PORT });
} catch (error) {
  server.log.fatal(error);
  await close("startup_failure");
  process.exitCode = 1;
}
