const express = require("express");
const authenticate = require("../middleware/authenticate");
const requireAdmin = require("../middleware/requireAdmin");
const {
  getAudit,
  getCompetitions,
  getIntegrityFlags,
  getParticipants,
  getQuizzes,
  getQuiz,
  getQuizOptions,
  patchIntegrityFlag,
  patchParticipantVerification,
  patchCompetitionSchedule,
  postCompetition,
  postIntegrityFlag,
  postQuiz,
  postQuizQuestions,
  putQuiz,
} = require("../controllers/admin.controller");
const asyncHandler = require("../utils/asyncHandler");

const router = express.Router();
router.use(authenticate, requireAdmin);
router.get("/quizzes/options", asyncHandler(getQuizOptions));
router.get("/quizzes", asyncHandler(getQuizzes));
router.get("/quizzes/:quizId", asyncHandler(getQuiz));
router.post("/quizzes", asyncHandler(postQuiz));
router.post("/quizzes/:quizId/questions", asyncHandler(postQuizQuestions));
router.put("/quizzes/:quizId", asyncHandler(putQuiz));
router.patch("/competitions/:competitionId/schedule", asyncHandler(patchCompetitionSchedule));
router.post("/competitions", asyncHandler(postCompetition));
router.get("/competitions", asyncHandler(getCompetitions));
router.get("/participants", asyncHandler(getParticipants));
router.patch("/participants/:participantId/verification", asyncHandler(patchParticipantVerification));
router.get("/audit", asyncHandler(getAudit));
router.get("/integrity", asyncHandler(getIntegrityFlags));
router.post("/integrity", asyncHandler(postIntegrityFlag));
router.patch("/integrity/:flagId", asyncHandler(patchIntegrityFlag));

module.exports = router;
