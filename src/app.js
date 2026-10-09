const compression = require("compression");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const pool = require("./db/pool");
const v1Routes = require("./routes/v1");
const errorHandler = require("./middleware/errorHandler");

function getAllowedOrigins() {
  return (process.env.FRONTEND_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function createApp() {
  const app = express();

  // Required behind a load balancer/reverse proxy so rate limiting sees real client IPs.
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: getAllowedOrigins() }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.status(200).json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({
      status: "success",
      message: "S2Answer API is running!",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
    });
  });
  app.use("/api/v1", v1Routes);
  app.use((_req, res) => res.status(404).json({ error: "Not found." }));
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
module.exports.getAllowedOrigins = getAllowedOrigins;
