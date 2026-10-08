const { joinCompetition, listCompetitions } = require("../services/competition.service");

async function getCompetitions(req, res) {
  return res.json({ competitions: await listCompetitions(req.user.sub) });
}

async function join(req, res) {
  const result = await joinCompetition(req.params.competitionId, req.user.sub);
  return res.json(result);
}

module.exports = { getCompetitions, join };
