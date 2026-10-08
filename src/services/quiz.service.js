const pool = require("../db/pool");

async function listQuizzes() {
  const { rows } = await pool.query(
    `SELECT q.id, q.title, q.description, COUNT(question.id)::integer AS question_count
       FROM quizzes q LEFT JOIN questions question ON question.quiz_id = q.id
      GROUP BY q.id ORDER BY q.created_at DESC`,
  );
  return rows;
}

module.exports = { listQuizzes };
