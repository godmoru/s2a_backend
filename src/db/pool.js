const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";
const useSsl =
  process.env.DATABASE_SSL === "true" ||
  (isProduction && process.env.DATABASE_SSL !== "false") ||
  (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("sslmode=require"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

module.exports = pool;
