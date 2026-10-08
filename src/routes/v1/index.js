const express = require("express");
const authRoutes = require("../auth.routes");
const quizRoutes = require("../quiz.routes");
const matchRoutes = require("../match.routes");
const leaderboardRoutes = require("../leaderboard.routes");
const adminRoutes = require("../admin.routes");
const competitionRoutes = require("../competition.routes");

const router = express.Router();
router.use("/auth", authRoutes);
router.use("/quizzes", quizRoutes);
router.use("/matches", matchRoutes);
router.use("/leaderboard", leaderboardRoutes);
router.use("/competitions", competitionRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
