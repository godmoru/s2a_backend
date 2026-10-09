require("dotenv").config();
const http = require("node:http");
const { Server } = require("socket.io");
const createApp = require("./app");
const { getAllowedOrigins } = createApp;
const pool = require("./db/pool");
const { registerMatchSocketHandlers } = require("./controllers/match.socket.controller");
const { restoreTimers } = require("./services/match.service");

async function startServer() {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error("DATABASE_URL and JWT_SECRET must be configured.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith("replace-this"))
  ) {
    throw new Error("JWT_SECRET must be a random string of at least 32 characters in production.");
  }

  const server = http.createServer(createApp());
  const io = new Server(server, { cors: { origin: getAllowedOrigins() } });
  registerMatchSocketHandlers(io);

  await restoreTimers();
  // Hosting platforms (Render, Railway, Heroku) inject PORT.
  const port = Number(process.env.PORT || process.env.BACKEND_PORT || 4000);
  server.listen(port, () => {
    console.log(`S2Answer API listening on port ${port}`);
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    io.close();
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(async (error) => {
  console.error("Could not start S2Answer API", error);
  await pool.end();
  process.exitCode = 1;
});
