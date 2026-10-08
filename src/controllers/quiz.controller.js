const { listQuizzes } = require("../services/quiz.service");

async function getQuizzes(_req, res) {
  return res.json({ quizzes: await listQuizzes() });
}

module.exports = { getQuizzes };
