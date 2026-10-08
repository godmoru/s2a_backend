const express = require("express");
const authenticate = require("../middleware/authenticate");
const { getLeaderboard } = require("../controllers/leaderboard.controller");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.get("/", authenticate, asyncHandler(getLeaderboard));

module.exports = router;
