const { getLeaderboard } = require("../services/leaderboard.service");

async function getLeaderboardController(req, res) {
  const competitionId = req.query.competitionId;
  if (typeof competitionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(competitionId)) {
    return res.status(400).json({ error: "Choose a valid competition to view its standings." });
  }
  const limit = Number(req.query.limit ?? 10);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return res.status(400).json({ error: "Leaderboard page size must be between 1 and 50." });
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return res.status(400).json({ error: "Leaderboard offset must be a non-negative integer." });
  }
  return res.json(await getLeaderboard({
    competitionId,
    userId: req.user.sub,
    limit,
    offset,
  }));
}

module.exports = { getLeaderboard: getLeaderboardController };
