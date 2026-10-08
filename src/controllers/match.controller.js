const { getMatchForPlayer } = require("../services/match.service");

async function get(req, res) {
  const match = await getMatchForPlayer(req.params.matchId, req.user.sub);
  return res.json({ match });
}

module.exports = { get };
