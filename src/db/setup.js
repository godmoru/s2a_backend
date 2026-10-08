require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const pool = require("./pool");

async function setup() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query(schema);
  await pool.query(
    `UPDATE match_players p
        SET current_question_index = CASE
              WHEN m.status = 'completed' THEN (
                SELECT COUNT(*)::integer FROM questions WHERE quiz_id = m.quiz_id
              )
              WHEN m.status = 'active' THEN GREATEST(m.current_question_index, 0)
              ELSE -1
            END,
            question_ends_at = CASE
              WHEN m.status = 'active'
               AND m.question_ends_at > NOW()
               AND NOT EXISTS (
                 SELECT 1 FROM answers a
                  WHERE a.match_id = p.match_id
                    AND a.user_id = p.user_id
                    AND a.question_index = m.current_question_index
               )
              THEN m.question_ends_at
              ELSE NULL
            END
       FROM matches m
      WHERE p.match_id = m.id
        AND p.current_question_index = -1
        AND m.status != 'lobby'`,
  );
  console.log("Database schema is ready.");
}

setup()
  .catch((error) => {
    console.error("Could not set up the database", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
