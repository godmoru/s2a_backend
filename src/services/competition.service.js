const pool = require("../db/pool");
const HttpError = require("../utils/httpError");
const { emitState, scheduleMatch } = require("./match.service");
const { recordAuditEvent } = require("./audit.service");

async function listCompetitions(userId) {
  const { rows } = await pool.query(
    `SELECT m.id, m.status, m.starts_at, m.duration_minutes,
            m.starts_at + (m.duration_minutes * INTERVAL '1 minute') AS ends_at,
            m.max_participants, m.expected_participants, q.id AS quiz_id,
            q.title, q.description,
            (SELECT COUNT(*)::integer FROM questions WHERE quiz_id = q.id) AS question_count,
            COUNT(p.user_id)::integer AS participant_count,
            BOOL_OR(p.user_id = $1) AS joined,
            (m.status IN ('scheduled', 'active')
             AND m.starts_at + (m.duration_minutes * INTERVAL '1 minute') > NOW()
             AND COUNT(p.user_id) < m.max_participants) AS can_join
       FROM matches m
       JOIN quizzes q ON q.id = m.quiz_id
       LEFT JOIN match_players p ON p.match_id = m.id
      WHERE m.status IN ('scheduled', 'active')
         OR EXISTS (
           SELECT 1 FROM match_players joined_player
            WHERE joined_player.match_id = m.id AND joined_player.user_id = $1
         )
      GROUP BY m.id, q.id
      ORDER BY m.starts_at ASC`,
    [userId],
  );
  return rows.map((row) => ({
    ...row,
    joined: row.joined === true,
    canJoin: row.can_join === true,
  }));
}

async function joinCompetition(matchId, userId) {
  const client = await pool.connect();
  let joined = false;
  try {
    await client.query("BEGIN");
    const competition = await client.query(
      `SELECT status, starts_at, duration_minutes, max_participants
         FROM matches WHERE id = $1 FOR UPDATE`,
      [matchId],
    );
    if (!competition.rowCount) throw new HttpError(404, "Competition not found.");
    const event = competition.rows[0];
    if (event.status === "completed") {
      throw new HttpError(409, "This competition has ended.");
    }
    const startsAt = new Date(event.starts_at).getTime();
    const endsAt = startsAt + Number(event.duration_minutes) * 60_000;
    if (endsAt <= Date.now()) {
      throw new HttpError(409, "This competition has ended.");
    }
    if (event.status === "scheduled" && startsAt <= Date.now()) {
      throw new HttpError(409, "This competition is starting. Refresh the list and try again.");
    }

    const existing = await client.query(
      "SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2",
      [matchId, userId],
    );
    if (!existing.rowCount) {
      const count = await client.query(
        "SELECT COUNT(*)::integer AS participant_count FROM match_players WHERE match_id = $1",
        [matchId],
      );
      if (count.rows[0].participant_count >= event.max_participants) {
        throw new HttpError(409, "This competition is full.");
      }
      await client.query(
        `INSERT INTO match_players (match_id, user_id)
         VALUES ($1, $2)`,
        [matchId, userId],
      );
      if (event.status === "active") {
        const question = await client.query(
          `SELECT q.time_limit_seconds
             FROM matches m
             JOIN questions q ON q.quiz_id = m.quiz_id AND q.position = 0
            WHERE m.id = $1`,
          [matchId],
        );
        if (!question.rowCount) throw new HttpError(409, "This competition has no available questions.");
        await client.query(
          `UPDATE match_players
              SET current_question_index = 0,
                  question_ends_at = LEAST(
                    NOW() + ($3 * INTERVAL '1 second'),
                    (SELECT starts_at + (duration_minutes * INTERVAL '1 minute')
                       FROM matches WHERE id = $1)
                  )
            WHERE match_id = $1 AND user_id = $2`,
          [matchId, userId, question.rows[0].time_limit_seconds],
        );
      }
      await recordAuditEvent(client, {
        actorUserId: userId,
        action: "competition_joined",
        entityType: "competition",
        entityId: matchId,
        metadata: { lateEntry: event.status === "active" },
      });
      joined = true;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (joined) {
    await emitState(matchId);
    await scheduleMatch(matchId);
  }
  return { matchId };
}

module.exports = { joinCompetition, listCompetitions };
