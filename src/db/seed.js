require("dotenv").config();
const pool = require("./pool");

const demoQuiz = {
  title: "General Knowledge",
  description: "A quick five-question challenge.",
  questions: [
    {
      prompt: "Which planet is known as the Red Planet?",
      options: ["Venus", "Mars", "Jupiter", "Mercury"],
      correctOption: 1,
    },
    {
      prompt: "How many sides does a hexagon have?",
      options: ["Five", "Six", "Seven", "Eight"],
      correctOption: 1,
    },
    {
      prompt: "What is the capital of Japan?",
      options: ["Seoul", "Beijing", "Tokyo", "Bangkok"],
      correctOption: 2,
    },
    {
      prompt: "Which ocean is the largest?",
      options: ["Atlantic", "Indian", "Arctic", "Pacific"],
      correctOption: 3,
    },
    {
      prompt: "What is 9 × 7?",
      options: ["56", "63", "72", "81"],
      correctOption: 1,
    },
  ],
};

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT id FROM quizzes WHERE title = $1",
      [demoQuiz.title],
    );
    let quizId;
    if (existing.rowCount) {
      quizId = existing.rows[0].id;
      await client.query("DELETE FROM questions WHERE quiz_id = $1", [quizId]);
      await client.query(
        "UPDATE quizzes SET description = $1 WHERE id = $2",
        [demoQuiz.description, quizId],
      );
    } else {
      const inserted = await client.query(
        "INSERT INTO quizzes (title, description) VALUES ($1, $2) RETURNING id",
        [demoQuiz.title, demoQuiz.description],
      );
      quizId = inserted.rows[0].id;
    }

    for (const [position, question] of demoQuiz.questions.entries()) {
      await client.query(
        `INSERT INTO questions
          (quiz_id, position, prompt, options, correct_option, points, time_limit_seconds)
         VALUES ($1, $2, $3, $4, $5, 1000, 20)`,
        [
          quizId,
          position,
          question.prompt,
          JSON.stringify(question.options),
          question.correctOption,
        ],
      );
    }
    await client.query("COMMIT");
    console.log("Demo quiz is ready.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error) => {
    console.error("Could not seed the database", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
