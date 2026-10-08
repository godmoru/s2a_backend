const express = require("express");
const authenticate = require("../middleware/authenticate");
const { getCompetitions, join } = require("../controllers/competition.controller");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authenticate);
router.get("/", asyncHandler(getCompetitions));
router.post("/:competitionId/join", asyncHandler(join));

module.exports = router;
