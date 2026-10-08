const pool = require("../db/pool");
const HttpError = require("../utils/httpError");
const { recordAuditEvent } = require("./audit.service");

const timerHandles = new Map();
let broadcastMatchState;

function setMatchBroadcaster(broadcaster) {
  broadcastMatchState = broadcaster;
}

async function publicMatchState(matchId, viewerId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.status, m.host_user_id, m.quiz_id, m.starts_at,
            m.duration_minutes,
            m.starts_at + (m.duration_minutes * INTERVAL '1 minute') AS ends_at,
            m.max_participants,
            q.title AS quiz_title,
            (SELECT COUNT(*) FROM questions WHERE quiz_id = m.quiz_id)::integer AS question_count,
            p.user_id, p.score, p.current_question_index, p.question_ends_at,
            u.username, u.role, a.selected_option, a.is_correct, a.points_awarded,
            a.answered_at
       FROM matches m
       JOIN quizzes q ON q.id = m.quiz_id
       JOIN match_players p ON p.match_id = m.id
       JOIN users u ON u.id = p.user_id
       LEFT JOIN answers a
         ON a.match_id = p.match_id
        AND a.user_id = p.user_id
        AND a.question_index = p.current_question_index
      WHERE m.id = $1
      ORDER BY p.joined_at, u.username`,
    [matchId],
  );
  if (!rows.length) return null;

  const match = rows[0];
  const questionCount = Number(match.question_count);
  const viewer = rows.find((row) => String(row.user_id) === String(viewerId));
  let question = null;
  if (viewer && viewer.current_question_index >= 0 && viewer.current_question_index < questionCount) {
    const result = await pool.query(
      `SELECT position, prompt, options, points, time_limit_seconds
         FROM questions WHERE quiz_id = $1 AND position = $2`,
      [match.quiz_id, viewer.current_question_index],
    );
    question = result.rows[0] || null;
  }

  const players = rows.filter((row) => row.role === "user").map((row) => ({
    userId: Number(row.user_id),
    username: row.username,
    score: row.score,
    questionIndex: row.current_question_index,
    completed: row.current_question_index >= questionCount,
    answered: row.selected_option !== null,
    timerExpired:
      row.current_question_index >= 0 &&
      row.current_question_index < questionCount &&
      row.selected_option === null &&
      row.question_ends_at === null,
  }));

  return {
    id: match.id,
    status: match.status,
    hostUserId: Number(match.host_user_id),
    startsAt: match.starts_at,
    endsAt: match.ends_at,
    durationMinutes: match.duration_minutes,
    maxParticipants: match.max_participants,
    quizTitle: match.quiz_title,
    questionIndex: viewer?.current_question_index ?? -1,
    questionCount,
    questionEndsAt: viewer?.question_ends_at ?? null,
    question,
    players,
    yourAnswer:
      viewer?.selected_option === null || !viewer
        ? null
        : {
            selectedOption: viewer.selected_option,
            isCorrect: viewer.is_correct,
            pointsAwarded: viewer.points_awarded,
            answeredAt: viewer.answered_at,
            answered: true,
          },
  };
}

async function emitState(matchId) {
  if (!broadcastMatchState) return;
  const { rows } = await pool.query(
    "SELECT user_id FROM match_players WHERE match_id = $1",
    [matchId],
  );
  for (const row of rows) {
    const state = await publicMatchState(matchId, row.user_id);
    if (state) await broadcastMatchState(matchId, row.user_id, state);
  }
}

function clearTimer(matchId) {
  const handle = timerHandles.get(matchId);
  if (handle) clearTimeout(handle);
  timerHandles.delete(matchId);
}

async function scheduleMatch(matchId) {
  clearTimer(matchId);
  const result = await pool.query(
    `SELECT m.status, m.starts_at, m.duration_minutes,
            GREATEST(
              0,
              EXTRACT(EPOCH FROM (
                LEAST(
                  COALESCE(
                    MIN(p.question_ends_at),
                    m.starts_at + (m.duration_minutes * INTERVAL '1 minute')
                  ),
                  m.starts_at + (m.duration_minutes * INTERVAL '1 minute')
                ) - NOW()
              )) * 1000
            ) AS delay_ms
       FROM matches m
       LEFT JOIN match_players p ON p.match_id = m.id
      WHERE m.id = $1
      GROUP BY m.id`,
    [matchId],
  );
  if (!result.rowCount) return;
  const match = result.rows[0];
  if (match.status === "scheduled") {
    const delay = Math.max(
      20,
      Math.min(new Date(match.starts_at).getTime() - Date.now(), 2_147_000_000),
    );
    const handle = setTimeout(async () => {
      timerHandles.delete(matchId);
      try {
        const started = await startScheduledMatch(matchId);
        if (!started) await scheduleMatch(matchId);
      } catch (error) {
        console.error(`Could not start scheduled competition ${matchId}`, error);
        await scheduleMatch(matchId);
      }
    }, delay);
    timerHandles.set(matchId, handle);
    return;
  }
  if (match.status !== "active" || match.delay_ms === null) return;

  const delay = Math.max(20, Math.min(Number(result.rows[0].delay_ms), 2_147_000_000));
  const handle = setTimeout(async () => {
    timerHandles.delete(matchId);
    try {
      await expireTimedOutPlayers(matchId);
      await scheduleMatch(matchId);
    } catch (error) {
      console.error(`Could not process match timers for ${matchId}`, error);
      await scheduleMatch(matchId);
    }
  }, delay);
  timerHandles.set(matchId, handle);
}

async function startScheduledMatch(matchId) {
  const client = await pool.connect();
  let started = false;
  try {
    await client.query("BEGIN");
    const matchResult = await client.query(
      `SELECT id, quiz_id, status, starts_at, duration_minutes
         FROM matches WHERE id = $1 FOR UPDATE`,
      [matchId],
    );
    if (
      !matchResult.rowCount ||
      matchResult.rows[0].status !== "scheduled" ||
      new Date(matchResult.rows[0].starts_at).getTime() > Date.now()
    ) {
      await client.query("COMMIT");
      return false;
    }

    const match = matchResult.rows[0];
    const questionResult = await client.query(
      `SELECT time_limit_seconds FROM questions
        WHERE quiz_id = $1 AND position = 0`,
      [match.quiz_id],
    );
    if (!questionResult.rowCount) {
      throw new HttpError(409, "Scheduled quiz has no questions.");
    }
    const endsAt = new Date(match.starts_at).getTime() + Number(match.duration_minutes) * 60_000;
    if (endsAt <= Date.now()) {
      await client.query(
        `UPDATE matches SET status = 'completed', completed_at = NOW(),
           question_ends_at = NULL
          WHERE id = $1`,
        [matchId],
      );
      await recordAuditEvent(client, {
        actorUserId: null,
        action: "competition_deadline_passed",
        entityType: "competition",
        entityId: matchId,
        metadata: { durationMinutes: match.duration_minutes },
      });
    } else {
      await client.query(
        `UPDATE matches SET status = 'active', current_question_index = 0,
           question_ends_at = LEAST(
             NOW() + ($2 * INTERVAL '1 second'),
             starts_at + (duration_minutes * INTERVAL '1 minute')
           )
         WHERE id = $1`,
        [matchId, questionResult.rows[0].time_limit_seconds],
      );
      await client.query(
        `UPDATE match_players
            SET current_question_index = 0,
                question_ends_at = LEAST(
                  NOW() + ($2 * INTERVAL '1 second'),
                  (SELECT starts_at + (duration_minutes * INTERVAL '1 minute')
                     FROM matches WHERE id = $1)
                )
          WHERE match_id = $1`,
        [matchId, questionResult.rows[0].time_limit_seconds],
      );
      await recordAuditEvent(client, {
        actorUserId: null,
        action: "competition_started",
        entityType: "competition",
        entityId: matchId,
        metadata: { durationMinutes: match.duration_minutes },
      });
    }
    await client.query("COMMIT");
    started = true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (started) {
    await emitState(matchId);
    await scheduleMatch(matchId);
  }
  return started;
}

async function expireTimedOutPlayers(matchId) {
  const client = await pool.connect();
  let changed = false;
  try {
    await client.query("BEGIN");
    const matchResult = await client.query(
      `SELECT id, quiz_id, status, starts_at, duration_minutes
         FROM matches WHERE id = $1 FOR UPDATE`,
      [matchId],
    );
    if (!matchResult.rowCount || matchResult.rows[0].status !== "active") {
      await client.query("COMMIT");
      return false;
    }
    const match = matchResult.rows[0];
    const endsAt = new Date(match.starts_at).getTime() + Number(match.duration_minutes) * 60_000;
    if (endsAt <= Date.now()) {
      await client.query(
        `UPDATE match_players SET question_ends_at = NULL WHERE match_id = $1`,
        [matchId],
      );
      await client.query(
        `UPDATE matches SET status = 'completed', completed_at = NOW(),
           question_ends_at = NULL WHERE id = $1`,
        [matchId],
      );
      await recordAuditEvent(client, {
        actorUserId: null,
        action: "competition_deadline_passed",
        entityType: "competition",
        entityId: matchId,
        metadata: { durationMinutes: match.duration_minutes },
      });
      changed = true;
      clearTimer(matchId);
      await client.query("COMMIT");
      if (changed) await emitState(matchId);
      return true;
    }

    const expired = await client.query(
      `UPDATE match_players
          SET question_ends_at = NULL
        WHERE match_id = $1 AND question_ends_at <= NOW()
        RETURNING user_id`,
      [matchId],
    );
    changed = expired.rowCount > 0;

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (changed) await emitState(matchId);
  return changed;
}

async function submitAnswer(matchId, userId, selectedOption) {
  if (!Number.isInteger(selectedOption) || selectedOption < 0) {
    throw new HttpError(400, "Choose a valid answer option.");
  }

  const client = await pool.connect();
  let answer;
  try {
    await client.query("BEGIN");
    const matchResult = await client.query(
      `SELECT id, quiz_id, status, starts_at, duration_minutes
         FROM matches WHERE id = $1 FOR UPDATE`,
      [matchId],
    );
    if (!matchResult.rowCount) throw new HttpError(404, "Match not found.");
    const match = matchResult.rows[0];
    if (match.status !== "active") {
      throw new HttpError(409, "This match is not accepting answers.");
    }
    const competitionEndsAt =
      new Date(match.starts_at).getTime() + Number(match.duration_minutes) * 60_000;
    if (competitionEndsAt <= Date.now()) {
      throw new HttpError(409, "The competition deadline has passed.");
    }

    const playerResult = await client.query(
      `SELECT current_question_index, question_ends_at
         FROM match_players WHERE match_id = $1 AND user_id = $2 FOR UPDATE`,
      [matchId, userId],
    );
    if (!playerResult.rowCount) throw new HttpError(403, "You are not in this match.");
    const player = playerResult.rows[0];
    if (player.current_question_index < 0) {
      throw new HttpError(409, "This match has not started.");
    }

    const previous = await client.query(
      `SELECT selected_option, is_correct, points_awarded, answered_at
         FROM answers
        WHERE match_id = $1 AND user_id = $2 AND question_index = $3`,
      [matchId, userId, player.current_question_index],
    );
    if (previous.rowCount) {
      if (previous.rows[0].selected_option !== selectedOption) {
        throw new HttpError(409, "You already answered this question.");
      }
      answer = previous.rows[0];
    } else {
      if (!player.question_ends_at || new Date(player.question_ends_at).getTime() <= Date.now()) {
        throw new HttpError(409, "Time is up for this question.");
      }

      const questionResult = await client.query(
        `SELECT options, correct_option, points, time_limit_seconds
           FROM questions WHERE quiz_id = $1 AND position = $2`,
        [match.quiz_id, player.current_question_index],
      );
      if (!questionResult.rowCount) throw new HttpError(404, "Current question was not found.");
      const question = questionResult.rows[0];
      if (selectedOption >= question.options.length) {
        throw new HttpError(400, "Choose a valid answer option.");
      }

      const elapsed = Math.max(
        0,
        question.time_limit_seconds * 1000 -
          (new Date(player.question_ends_at).getTime() - Date.now()),
      );
      const remainingRatio = Math.max(
        0,
        Math.min(1, 1 - elapsed / (question.time_limit_seconds * 1000)),
      );
      const correct = selectedOption === question.correct_option;
      const pointsAwarded = correct
        ? Math.round(question.points * (0.5 + 0.5 * remainingRatio))
        : 0;
      const inserted = await client.query(
        `INSERT INTO answers
           (match_id, user_id, question_index, selected_option, is_correct, points_awarded)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING selected_option, is_correct, points_awarded, answered_at`,
        [
          matchId,
          userId,
          player.current_question_index,
          selectedOption,
          correct,
          pointsAwarded,
        ],
      );
      await client.query(
        `UPDATE match_players
            SET score = score + $3, question_ends_at = NULL
          WHERE match_id = $1 AND user_id = $2`,
        [matchId, userId, pointsAwarded],
      );
      await recordAuditEvent(client, {
        actorUserId: userId,
        action: "answer_submitted",
        entityType: "competition",
        entityId: matchId,
        metadata: {
          questionIndex: player.current_question_index,
          correct,
          pointsAwarded,
        },
      });
      answer = inserted.rows[0];
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await emitState(matchId);
  await scheduleMatch(matchId);
  return answer;
}

async function advancePlayer(matchId, userId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const matchResult = await client.query(
      `SELECT id, quiz_id, status, starts_at, duration_minutes
         FROM matches WHERE id = $1 FOR UPDATE`,
      [matchId],
    );
    if (!matchResult.rowCount) throw new HttpError(404, "Match not found.");
    const match = matchResult.rows[0];
    if (match.status !== "active") {
      throw new HttpError(409, "This match is not accepting progress.");
    }
    const competitionEndsAt =
      new Date(match.starts_at).getTime() + Number(match.duration_minutes) * 60_000;
    if (competitionEndsAt <= Date.now()) {
      throw new HttpError(409, "The competition deadline has passed.");
    }

    const playerResult = await client.query(
      `SELECT current_question_index, question_ends_at
         FROM match_players WHERE match_id = $1 AND user_id = $2 FOR UPDATE`,
      [matchId, userId],
    );
    if (!playerResult.rowCount) throw new HttpError(403, "You are not in this match.");
    const player = playerResult.rows[0];
    const questionCountResult = await client.query(
      "SELECT COUNT(*)::integer AS question_count FROM questions WHERE quiz_id = $1",
      [match.quiz_id],
    );
    const questionCount = questionCountResult.rows[0].question_count;
    if (player.current_question_index >= questionCount) {
      await client.query("COMMIT");
      return;
    }
    if (player.current_question_index < 0) {
      throw new HttpError(409, "This match has not started.");
    }

    const answer = await client.query(
      `SELECT 1 FROM answers
        WHERE match_id = $1 AND user_id = $2 AND question_index = $3`,
      [matchId, userId, player.current_question_index],
    );
    if (
      !answer.rowCount &&
      player.question_ends_at &&
      new Date(player.question_ends_at).getTime() > Date.now()
    ) {
      throw new HttpError(409, "Wait for the timer to finish or submit your answer.");
    }

    const nextIndex = player.current_question_index + 1;
    if (nextIndex < questionCount) {
      const nextQuestion = await client.query(
        `SELECT time_limit_seconds FROM questions
          WHERE quiz_id = $1 AND position = $2`,
        [match.quiz_id, nextIndex],
      );
      await client.query(
        `UPDATE match_players
            SET current_question_index = $3,
                question_ends_at = LEAST(
                  NOW() + ($4 * INTERVAL '1 second'),
                  (SELECT starts_at + (duration_minutes * INTERVAL '1 minute')
                     FROM matches WHERE id = $1)
                )
          WHERE match_id = $1 AND user_id = $2`,
        [matchId, userId, nextIndex, nextQuestion.rows[0].time_limit_seconds],
      );
    } else {
      await client.query(
        `UPDATE match_players
            SET current_question_index = $3, question_ends_at = NULL
          WHERE match_id = $1 AND user_id = $2`,
        [matchId, userId, questionCount],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await emitState(matchId);
  await scheduleMatch(matchId);
}

async function getMatchForPlayer(matchId, userId) {
  const membership = await pool.query(
    "SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2",
    [matchId, userId],
  );
  if (!membership.rowCount) throw new HttpError(403, "You are not in this match.");
  await expireTimedOutPlayers(matchId);
  const state = await publicMatchState(matchId, userId);
  if (!state) throw new HttpError(404, "Match not found.");
  return state;
}

async function restoreTimers() {
  const { rows } = await pool.query(
    "SELECT id FROM matches WHERE status IN ('scheduled', 'active')",
  );
  for (const row of rows) {
    await expireTimedOutPlayers(row.id);
    await scheduleMatch(row.id);
  }
}

module.exports = {
  advancePlayer,
  emitState,
  expireTimedOutPlayers,
  getMatchForPlayer,
  publicMatchState,
  restoreTimers,
  scheduleMatch,
  setMatchBroadcaster,
  startScheduledMatch,
  submitAnswer,
};
