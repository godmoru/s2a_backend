require("dotenv").config();
const http = require("node:http");
const { Server } = require("socket.io");
const createApp = require("./app");
const pool = require("./db/pool");
const { registerMatchSocketHandlers } = require("./controllers/match.socket.controller");
const { restoreTimers } = require("./services/match.service");

async function startServer() {
  if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
    throw new Error("DATABASE_URL and JWT_SECRET must be configured.");
  }

  const server = http.createServer(createApp());
  const allowedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
  const io = new Server(server, { cors: { origin: allowedOrigin } });
  registerMatchSocketHandlers(io);

  await restoreTimers();
  const port = Number(process.env.BACKEND_PORT || 4000);
  server.listen(port, () => {
    console.log(`S2Answer API listening on port ${port}`);
  });
}

startServer().catch(async (error) => {
  console.error("Could not start S2Answer API", error);
  await pool.end();
  process.exitCode = 1;
});
