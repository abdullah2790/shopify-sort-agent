require("dotenv").config();
const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL
  ? process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]ssl=[^&]*/g, "")
  : undefined;

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => console.error("DB pool error:", err.message));

module.exports = pool;
