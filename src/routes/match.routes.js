const express = require("express");
const authenticate = require("../middleware/authenticate");
const { get } = require("../controllers/match.controller");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authenticate);
router.get("/:matchId", asyncHandler(get));

module.exports = router;
