const express = require("express");
const authenticate = require("../middleware/authenticate");
const { getQuizzes } = require("../controllers/quiz.controller");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.get("/", authenticate, asyncHandler(getQuizzes));

module.exports = router;
