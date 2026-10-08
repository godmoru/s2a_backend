const cors = require("cors");
const express = require("express");
const v1Routes = require("./routes/v1");
const errorHandler = require("./middleware/errorHandler");

function createApp() {
  const app = express();
  const allowedOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

  app.use(cors({ origin: allowedOrigin }));
  app.use(express.json({ limit: "2mb" }));
  // app.get("/health", (_req, res) => res.json({ status: "ok" }));
  // Health check endpoint
  app.get('/api/v1/health', (req, res) => {
    res.status(200).json({
      status: 'success',
      message: 'S2Answer API is running!',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });
  });
  app.use("/api/v1", v1Routes);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
