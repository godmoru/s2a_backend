const pool = require("../db/pool");
const HttpError = require("../utils/httpError");

async function getLeaderboard({ competitionId, userId, limit, offset }) {
  const membership = await pool.query(
    `SELECT 1 FROM match_players
      WHERE match_id = $1 AND user_id = $2`,
    [competitionId, userId],
  );
  if (!membership.rowCount) {
    throw new HttpError(403, "You can only view standings for competitions you have joined.");
  }

  const [players, count] = await Promise.all([
    pool.query(
      `WITH ranked AS (
         SELECT u.id AS user_id, u.username, p.score,
                RANK() OVER (ORDER BY p.score DESC, p.joined_at ASC, u.username ASC) AS rank
           FROM match_players p
           JOIN users u ON u.id = p.user_id
          WHERE p.match_id = $1 AND u.role = 'user'
       )
       SELECT user_id, username, score, rank
         FROM ranked
        WHERE rank > $2 AND rank <= $2 + $3
        ORDER BY rank`,
      [competitionId, offset, limit],
    ),
    pool.query(
      `SELECT COUNT(*)::integer AS total
         FROM match_players p
         JOIN users u ON u.id = p.user_id
        WHERE p.match_id = $1 AND u.role = 'user'`,
      [competitionId],
    ),
  ]);
  const total = count.rows[0].total;
  return {
    leaderboard: players.rows,
    total,
    hasMore: offset + players.rowCount < total,
    nextOffset: offset + players.rowCount,
  };
}

module.exports = { getLeaderboard };
