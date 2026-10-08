const pool = require("../db/pool");
const HttpError = require("../utils/httpError");
const { scheduleMatch } = require("./match.service");
const { recordAuditEvent } = require("./audit.service");

async function assertQuizEditable(client, quizId) {
  await client.query("SELECT id FROM matches WHERE quiz_id = $1 FOR UPDATE", [quizId]);
  const used = await client.query(
    `SELECT 1
       FROM matches m
      WHERE m.quiz_id = $1
        AND (
          m.status IN ('active', 'completed')
          OR EXISTS (
            SELECT 1 FROM match_players p WHERE p.match_id = m.id
          )
        )
      LIMIT 1`,
    [quizId],
  );
  if (used.rowCount) {
    throw new HttpError(409, "A question set cannot be changed after a linked competition starts or gains participants.");
  }
}

async function listAdminQuizzes({ limit, offset }) {
  const [result, count] = await Promise.all([
    pool.query(
    `SELECT q.id, q.title, q.description, COUNT(question.id)::integer AS question_count
       FROM quizzes q LEFT JOIN questions question ON question.quiz_id = q.id
      GROUP BY q.id ORDER BY q.created_at DESC, q.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
    ),
    pool.query("SELECT COUNT(*)::integer AS total FROM quizzes"),
  ]);
  return { quizzes: result.rows, total: count.rows[0].total };
}

async function listAdminQuizOptions() {
  const { rows } = await pool.query(
    "SELECT id, title FROM quizzes ORDER BY created_at DESC, id DESC",
  );
  return rows;
}

async function getAdminQuiz(quizId) {
  const { rows } = await pool.query(
    `SELECT q.id, q.title, q.description,
            COALESCE(
              json_agg(
                json_build_object(
                  'prompt', question.prompt,
                  'options', question.options,
                  'correctOption', question.correct_option,
                  'points', question.points,
                  'timeLimitSeconds', question.time_limit_seconds
                ) ORDER BY question.position
              ) FILTER (WHERE question.id IS NOT NULL),
              '[]'::json
            ) AS questions
       FROM quizzes q
       LEFT JOIN questions question ON question.quiz_id = q.id
      WHERE q.id = $1
      GROUP BY q.id`,
    [quizId],
  );
  if (!rows[0]) return null;
  const { rows: competitions } = await pool.query(
    `SELECT m.id, m.status, m.starts_at, m.duration_minutes,
            m.expected_participants, m.max_participants,
            (m.status = 'scheduled' AND m.starts_at > NOW()
             AND NOT EXISTS (
               SELECT 1 FROM match_players p WHERE p.match_id = m.id
             )) AS editable
       FROM matches m
      WHERE m.quiz_id = $1
      ORDER BY m.starts_at`,
    [quizId],
  );
  return { ...rows[0], competitions };
}

async function updateQuiz({ quizId, title, description, questions, adminUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quiz = await client.query(
      "SELECT id FROM quizzes WHERE id = $1 FOR UPDATE",
      [quizId],
    );
    if (!quiz.rowCount) throw new HttpError(404, "Quiz not found.");
    await assertQuizEditable(client, quizId);
    const { rows } = await client.query(
      `UPDATE quizzes SET title = $1, description = $2
        WHERE id = $3 RETURNING id, title, description`,
      [title.trim(), (description || "").trim(), quizId],
    );
    await client.query("DELETE FROM questions WHERE quiz_id = $1", [quizId]);
    for (const [position, question] of questions.entries()) {
      await client.query(
        `INSERT INTO questions
           (quiz_id, position, prompt, options, correct_option, points, time_limit_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          quizId,
          position,
          question.prompt.trim(),
          JSON.stringify(question.options.map((option) => option.trim())),
          question.correctOption,
          question.points,
          question.timeLimitSeconds,
        ],
      );
    }
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "question_set_updated",
      entityType: "quiz",
      entityId: quizId,
      metadata: { title: rows[0].title, questionCount: questions.length },
    });
    await client.query("COMMIT");
    return { ...rows[0], questionCount: questions.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createQuiz({ title, description, questions, adminUserId }) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "INSERT INTO quizzes (title, description) VALUES ($1, $2) RETURNING id, title, description",
      [title.trim(), (description || "").trim()],
    );
    const quiz = result.rows[0];
    for (const [position, question] of questions.entries()) {
      await client.query(
        `INSERT INTO questions
           (quiz_id, position, prompt, options, correct_option, points, time_limit_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          quiz.id,
          position,
          question.prompt.trim(),
          JSON.stringify(question.options.map((option) => option.trim())),
          question.correctOption,
          question.points,
          question.timeLimitSeconds,
        ],
      );
    }
    const competitionResult = await client.query(
      `INSERT INTO matches
         (quiz_id, host_user_id, starts_at, duration_minutes, max_participants, expected_participants, status)
       VALUES ($1, $2, NOW(), 60, 80, 80, 'active')
       RETURNING id, status, starts_at, starts_at + (duration_minutes * INTERVAL '1 minute') AS ends_at,
                 duration_minutes, max_participants, expected_participants`,
      [quiz.id, adminUserId],
    );
    const competition = competitionResult.rows[0];
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "question_set_created",
      entityType: "quiz",
      entityId: quiz.id,
      metadata: { title: quiz.title, questionCount: questions.length },
    });
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "competition_published",
      entityType: "competition",
      entityId: competition.id,
      metadata: {
        quizId: quiz.id,
        title: quiz.title,
        startsAt: competition.starts_at,
        durationMinutes: competition.duration_minutes,
        maxParticipants: competition.max_participants,
        expectedParticipants: competition.expected_participants,
        status: competition.status,
      },
    });
    await client.query("COMMIT");
    committed = true;
    await scheduleMatch(competition.id);
    return { ...quiz, questionCount: questions.length, competition };
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addQuestionsToQuiz({ quizId, questions, adminUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quiz = await client.query(
      "SELECT id, title FROM quizzes WHERE id = $1 FOR UPDATE",
      [quizId],
    );
    if (!quiz.rowCount) throw new HttpError(404, "Quiz not found.");
    await assertQuizEditable(client, quizId);
    const { rows: currentQuestions } = await client.query(
      `SELECT COALESCE(MAX(position), -1)::integer AS last_position,
              COUNT(*)::integer AS question_count
         FROM questions WHERE quiz_id = $1`,
      [quizId],
    );
    if (currentQuestions[0].question_count + questions.length > 100) {
      throw new HttpError(400, "A question set cannot contain more than 100 questions.");
    }
    const firstPosition = currentQuestions[0].last_position + 1;
    for (const [index, question] of questions.entries()) {
      await client.query(
        `INSERT INTO questions
           (quiz_id, position, prompt, options, correct_option, points, time_limit_seconds)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          quizId,
          firstPosition + index,
          question.prompt.trim(),
          JSON.stringify(question.options.map((option) => option.trim())),
          question.correctOption,
          question.points,
          question.timeLimitSeconds,
        ],
      );
    }
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "questions_added_to_quiz",
      entityType: "quiz",
      entityId: quizId,
      metadata: { title: quiz.rows[0].title, questionCount: questions.length },
    });
    await client.query("COMMIT");
    return { quizId, questionCount: questions.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createCompetition({ quizId, startsAt, durationMinutes, maxParticipants, expectedParticipants, adminUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const quiz = await client.query(
      `SELECT id FROM quizzes
        WHERE id = $1 AND EXISTS (SELECT 1 FROM questions WHERE quiz_id = $1)`,
      [quizId],
    );
    if (!quiz.rowCount) throw new HttpError(404, "Quiz not found or has no questions.");
    const result = await client.query(
      `INSERT INTO matches
         (quiz_id, host_user_id, starts_at, duration_minutes, max_participants, expected_participants, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
       RETURNING id, starts_at, duration_minutes, max_participants, expected_participants`,
      [quizId, adminUserId, startsAt, durationMinutes, maxParticipants, expectedParticipants],
    );
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "competition_scheduled",
      entityType: "competition",
      entityId: result.rows[0].id,
      metadata: { quizId, startsAt, durationMinutes, maxParticipants, expectedParticipants },
    });
    await client.query("COMMIT");
    await scheduleMatch(result.rows[0].id);
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateCompetitionSchedule({
  competitionId,
  startsAt,
  durationMinutes,
  maxParticipants,
  expectedParticipants,
  adminUserId,
}) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const competition = await client.query(
      `SELECT m.id, m.status, m.quiz_id, m.starts_at,
              q.title AS quiz_title,
              EXISTS (SELECT 1 FROM match_players p WHERE p.match_id = m.id) AS has_participants
         FROM matches m
         JOIN quizzes q ON q.id = m.quiz_id
        WHERE m.id = $1
        FOR UPDATE OF m`,
      [competitionId],
    );
    if (!competition.rowCount) throw new HttpError(404, "Competition not found.");
    const current = competition.rows[0];
    if (current.status !== "scheduled" || current.has_participants || new Date(current.starts_at) <= new Date()) {
      throw new HttpError(409, "Only future competitions with no participants can be rescheduled.");
    }
    const { rows } = await client.query(
      `UPDATE matches
          SET starts_at = $1,
              duration_minutes = $2,
              max_participants = $3,
              expected_participants = $4
        WHERE id = $5
        RETURNING id, starts_at, duration_minutes, max_participants, expected_participants`,
      [startsAt, durationMinutes, maxParticipants, expectedParticipants, competitionId],
    );
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "competition_schedule_updated",
      entityType: "competition",
      entityId: competitionId,
      metadata: {
        quizId: current.quiz_id,
        quizTitle: current.quiz_title,
        startsAt,
        durationMinutes,
        maxParticipants,
        expectedParticipants,
      },
    });
    await client.query("COMMIT");
    committed = true;
    await scheduleMatch(competitionId);
    return rows[0];
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function listAdminCompetitions() {
  const { rows } = await pool.query(
    `SELECT m.id, m.status, m.starts_at, m.duration_minutes,
            m.starts_at + (m.duration_minutes * INTERVAL '1 minute') AS ends_at,
            m.max_participants, m.expected_participants, q.title, q.id AS quiz_id,
            COUNT(p.user_id)::integer AS participant_count,
            COUNT(*) FILTER (WHERE p.current_question_index >= (
              SELECT COUNT(*) FROM questions WHERE quiz_id = q.id
            ))::integer AS completed_participants
       FROM matches m
       JOIN quizzes q ON q.id = m.quiz_id
       LEFT JOIN match_players p ON p.match_id = m.id
      GROUP BY m.id, q.id
      ORDER BY m.starts_at DESC`,
  );
  return rows;
}

async function listAdminParticipants({ search, verification, limit, offset }) {
  const params = [];
  const conditions = ["u.role = 'user'"];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(u.username ILIKE $${params.length} OR u.email ILIKE $${params.length}
      OR u.participant_id ILIKE $${params.length})`);
  }
  if (verification === "verified") conditions.push("u.email_verified_at IS NOT NULL");
  if (verification === "unverified") conditions.push("u.email_verified_at IS NULL");
  const where = conditions.join(" AND ");
  const countResult = await pool.query(
    `SELECT COUNT(*)::integer AS total FROM users u WHERE ${where}`,
    params,
  );
  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT u.id, u.participant_id, u.username, u.email, u.email_verified_at,
            u.email_verification_method, u.created_at,
            (SELECT COUNT(*)::integer FROM match_players mp WHERE mp.user_id = u.id) AS competitions_joined,
            (SELECT COALESCE(SUM(mp.score), 0)::integer FROM match_players mp WHERE mp.user_id = u.id) AS total_score,
            (SELECT COUNT(*)::integer FROM integrity_flags f
              WHERE f.participant_user_id = u.id AND f.status = 'open') AS open_flags
       FROM users u
      WHERE ${where}
      ORDER BY u.created_at DESC
      LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
    dataParams,
  );
  return { participants: rows, total: countResult.rows[0].total };
}

async function listAuditEvents({ limit, offset }) {
  const { rows } = await pool.query(
    `SELECT e.id, e.action, e.entity_type, e.entity_id, e.metadata, e.created_at,
            u.username AS actor_username, u.participant_id AS actor_participant_id
       FROM audit_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows;
}

async function listIntegrityFlags(status) {
  const params = [];
  const where = status && status !== "all" ? "WHERE f.status = $1" : "";
  if (where) params.push(status);
  const { rows } = await pool.query(
    `SELECT f.id, f.category, f.details, f.status, f.created_at, f.reviewed_at,
            f.competition_id, participant.id AS participant_user_id,
            participant.participant_id, participant.username, participant.email,
            competition.title AS competition_title,
            creator.username AS created_by, reviewer.username AS reviewed_by
       FROM integrity_flags f
       JOIN users participant ON participant.id = f.participant_user_id
       LEFT JOIN matches m ON m.id = f.competition_id
       LEFT JOIN quizzes competition ON competition.id = m.quiz_id
       LEFT JOIN users creator ON creator.id = f.created_by_user_id
       LEFT JOIN users reviewer ON reviewer.id = f.reviewed_by_user_id
       ${where}
      ORDER BY CASE f.status WHEN 'open' THEN 0 ELSE 1 END, f.created_at DESC`,
    params,
  );
  return rows;
}

async function createIntegrityFlag({ participantId, competitionId, category, details, adminUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const participant = await client.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'user' FOR UPDATE",
      [participantId],
    );
    if (!participant.rowCount) throw new HttpError(404, "Participant not found.");
    if (competitionId) {
      const membership = await client.query(
        "SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2",
        [competitionId, participantId],
      );
      if (!membership.rowCount) throw new HttpError(400, "Participant is not enrolled in that competition.");
    }
    const result = await client.query(
      `INSERT INTO integrity_flags
         (participant_user_id, competition_id, category, details, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, status, created_at`,
      [participantId, competitionId || null, category, details, adminUserId],
    );
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "integrity_flag_created",
      entityType: "integrity_flag",
      entityId: result.rows[0].id,
      metadata: { participantId, competitionId: competitionId || null, category },
    });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateIntegrityFlag({ flagId, status, adminUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE integrity_flags
          SET status = $2,
              reviewed_by_user_id = $3,
              reviewed_at = CASE WHEN $2 = 'open' THEN NULL ELSE NOW() END
        WHERE id = $1
        RETURNING id, status`,
      [flagId, status, adminUserId],
    );
    if (!result.rowCount) throw new HttpError(404, "Integrity flag not found.");
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: "integrity_flag_updated",
      entityType: "integrity_flag",
      entityId: flagId,
      metadata: { status },
    });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setParticipantVerification({ participantId, verified, adminUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE users
          SET email_verified_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
              email_verification_method = CASE WHEN $2 THEN 'admin_manual' ELSE NULL END
        WHERE id = $1 AND role = 'user'
        RETURNING id, participant_id, email_verified_at, email_verification_method`,
      [participantId, verified],
    );
    if (!result.rowCount) throw new HttpError(404, "Participant not found.");
    await recordAuditEvent(client, {
      actorUserId: adminUserId,
      action: verified ? "participant_manually_verified" : "participant_verification_revoked",
      entityType: "participant",
      entityId: participantId,
      metadata: { verificationMethod: "admin_manual_review" },
    });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createCompetition,
  addQuestionsToQuiz,
  createIntegrityFlag,
  createQuiz,
  getAdminQuiz,
  listAdminCompetitions,
  updateQuiz,
  updateCompetitionSchedule,
  listAdminQuizOptions,
  listAdminParticipants,
  listAdminQuizzes,
  listAuditEvents,
  listIntegrityFlags,
  setParticipantVerification,
  updateIntegrityFlag,
};
