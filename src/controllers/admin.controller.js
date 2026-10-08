const HttpError = require("../utils/httpError");
const {
  createCompetition,
  addQuestionsToQuiz,
  createIntegrityFlag,
  createQuiz,
  getAdminQuiz,
  listAdminCompetitions,
  listAdminParticipants,
  listAdminQuizOptions,
  listAdminQuizzes,
  listAuditEvents,
  listIntegrityFlags,
  setParticipantVerification,
  updateQuiz,
  updateCompetitionSchedule,
  updateIntegrityFlag,
} = require("../services/admin.service");

function validateQuiz(body) {
  if (
    !body ||
    typeof body.title !== "string" ||
    body.title.trim().length < 2 ||
    body.title.trim().length > 160 ||
    typeof (body.description ?? "") !== "string" ||
    !Array.isArray(body.questions) ||
    body.questions.length < 1 ||
    body.questions.length > 100
  ) {
    throw new HttpError(400, "Provide a quiz title and 1–100 questions.");
  }
  for (const [index, question] of body.questions.entries()) {
    if (
      !question ||
      typeof question.prompt !== "string" ||
      !question.prompt.trim() ||
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 6 ||
      question.options.some((option) => typeof option !== "string" || !option.trim()) ||
      !Number.isInteger(question.correctOption) ||
      question.correctOption < 0 ||
      question.correctOption >= question.options.length ||
      !Number.isInteger(question.points ?? 1000) ||
      (question.points ?? 1000) < 1 ||
      (question.points ?? 1000) > 100000 ||
      !Number.isInteger(question.timeLimitSeconds ?? 20) ||
      (question.timeLimitSeconds ?? 20) < 5 ||
      (question.timeLimitSeconds ?? 20) > 300
    ) {
      throw new HttpError(
        400,
        `Question ${index + 1} must include a prompt, 2–6 options, a valid correct option, points and a 5–300 second limit.`,
      );
    }
    question.points ??= 1000;
    question.timeLimitSeconds ??= 20;
  }
}

async function getQuizzes(req, res) {
  const limit = Number(req.query.limit ?? 5);
  const offset = Number(req.query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5 ||
      !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new HttpError(400, "Quiz pagination must use a limit from 1 to 5 and a non-negative offset.");
  }
  return res.json(await listAdminQuizzes({ limit, offset }));
}

async function getQuizOptions(_req, res) {
  return res.json({ quizzes: await listAdminQuizOptions() });
}

async function getQuiz(req, res) {
  const quizId = Number(req.params.quizId);
  if (!Number.isSafeInteger(quizId) || quizId <= 0) {
    throw new HttpError(400, "Choose a valid quiz.");
  }
  const quiz = await getAdminQuiz(quizId);
  if (!quiz) throw new HttpError(404, "Quiz not found.");
  return res.json({ quiz });
}

async function postQuiz(req, res) {
  validateQuiz(req.body);
  const quiz = await createQuiz({ ...req.body, adminUserId: req.user.sub });
  return res.status(201).json({ quiz });
}

async function putQuiz(req, res) {
  const quizId = Number(req.params.quizId);
  if (!Number.isSafeInteger(quizId) || quizId <= 0) {
    throw new HttpError(400, "Choose a valid quiz.");
  }
  validateQuiz(req.body);
  const quiz = await updateQuiz({
    quizId,
    ...req.body,
    adminUserId: req.user.sub,
  });
  return res.json({ quiz });
}

async function postQuizQuestions(req, res) {
  const quizId = Number(req.params.quizId);
  if (!Number.isSafeInteger(quizId) || quizId <= 0) {
    throw new HttpError(400, "Choose a valid quiz.");
  }
  const { questions } = req.body || {};
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 100) {
    throw new HttpError(400, "Provide 1–100 questions to add.");
  }
  validateQuiz({ title: "Imported questions", questions });
  const result = await addQuestionsToQuiz({
    quizId,
    questions,
    adminUserId: req.user.sub,
  });
  return res.status(201).json(result);
}

async function postCompetition(req, res) {
  const quizId = Number(req.body?.quizId);
  const maxParticipants = Number(req.body?.maxParticipants);
  const expectedParticipants = Number(req.body?.expectedParticipants ?? maxParticipants);
  const durationMinutes = Number(req.body?.durationMinutes ?? 60);
  const startDate = new Date(req.body?.startsAt);
  if (!Number.isSafeInteger(quizId) || quizId <= 0) {
    throw new HttpError(400, "Choose a valid quiz.");
  }
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 320) {
    throw new HttpError(400, "Maximum participants must be between 1 and 320.");
  }
  if (!Number.isInteger(expectedParticipants) || expectedParticipants < 1 || expectedParticipants > maxParticipants) {
    throw new HttpError(400, "Expected participants must be between 1 and the maximum capacity.");
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new HttpError(400, "Competition duration must be between 1 and 1440 minutes.");
  }
  if (!req.body?.startsAt || Number.isNaN(startDate.getTime()) || startDate.getTime() <= Date.now()) {
    throw new HttpError(400, "Choose a future start date and time.");
  }
  const competition = await createCompetition({
    quizId,
    startsAt: startDate,
    durationMinutes,
    maxParticipants,
    expectedParticipants,
    adminUserId: req.user.sub,
  });
  return res.status(201).json({ competition });
}

async function patchCompetitionSchedule(req, res) {
  const competitionId = req.params.competitionId;
  const { startsAt } = req.body || {};
  const maxParticipants = Number(req.body?.maxParticipants);
  const expectedParticipants = Number(req.body?.expectedParticipants);
  const durationMinutes = Number(req.body?.durationMinutes);
  const startDate = new Date(startsAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(competitionId)) {
    throw new HttpError(400, "Choose a valid competition.");
  }
  if (!startsAt || Number.isNaN(startDate.getTime()) || startDate.getTime() <= Date.now()) {
    throw new HttpError(400, "Choose a future start date and time.");
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new HttpError(400, "Competition duration must be between 1 and 1440 minutes.");
  }
  if (!Number.isInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 320) {
    throw new HttpError(400, "Maximum participants must be between 1 and 320.");
  }
  if (!Number.isInteger(expectedParticipants) || expectedParticipants < 1 || expectedParticipants > maxParticipants) {
    throw new HttpError(400, "Expected participants must be between 1 and the maximum capacity.");
  }
  const competition = await updateCompetitionSchedule({
    competitionId,
    startsAt: startDate,
    durationMinutes,
    maxParticipants,
    expectedParticipants,
    adminUserId: req.user.sub,
  });
  return res.json({ competition });
}

function pagination(query) {
  const limit = Number(query.limit ?? 25);
  const offset = Number(query.offset ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
      !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new HttpError(400, "Pagination must use a limit from 1 to 100 and a non-negative offset.");
  }
  return { limit, offset };
}

async function getCompetitions(_req, res) {
  return res.json({ competitions: await listAdminCompetitions() });
}

async function getParticipants(req, res) {
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const verification = req.query.verification || "all";
  if (!["all", "verified", "unverified"].includes(verification)) {
    throw new HttpError(400, "Choose all, verified, or unverified.");
  }
  const result = await listAdminParticipants({
    search,
    verification,
    ...pagination(req.query),
  });
  return res.json(result);
}

async function patchParticipantVerification(req, res) {
  const participantId = Number(req.params.participantId);
  if (!Number.isSafeInteger(participantId) || participantId <= 0 ||
      typeof req.body?.verified !== "boolean") {
    throw new HttpError(400, "Provide a valid participant ID and verification status.");
  }
  const participant = await setParticipantVerification({
    participantId,
    verified: req.body.verified,
    adminUserId: req.user.sub,
  });
  return res.json({ participant });
}

async function getAudit(req, res) {
  return res.json({ events: await listAuditEvents(pagination(req.query)) });
}

async function getIntegrityFlags(req, res) {
  const status = req.query.status || "all";
  if (!["all", "open", "reviewed", "dismissed"].includes(status)) {
    throw new HttpError(400, "Choose all, open, reviewed, or dismissed.");
  }
  return res.json({ flags: await listIntegrityFlags(status) });
}

async function postIntegrityFlag(req, res) {
  const participantId = Number(req.body?.participantId);
  const competitionId = req.body?.competitionId || null;
  const category = typeof req.body?.category === "string" ? req.body.category.trim() : "";
  const details = typeof req.body?.details === "string" ? req.body.details.trim() : "";
  if (!Number.isSafeInteger(participantId) || participantId <= 0 ||
      (competitionId !== null &&
        (typeof competitionId !== "string" ||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(competitionId))) ||
      category.length < 2 || category.length > 60 ||
      details.length < 3 || details.length > 2000) {
    throw new HttpError(400, "Provide a valid participant, category (2–60 characters), and details (3–2000 characters).");
  }
  const flag = await createIntegrityFlag({
    participantId,
    competitionId,
    category,
    details,
    adminUserId: req.user.sub,
  });
  return res.status(201).json({ flag });
}

async function patchIntegrityFlag(req, res) {
  const flagId = Number(req.params.flagId);
  const status = req.body?.status;
  if (!Number.isSafeInteger(flagId) || flagId <= 0 ||
      !["open", "reviewed", "dismissed"].includes(status)) {
    throw new HttpError(400, "Provide a valid flag ID and status.");
  }
  return res.json({
    flag: await updateIntegrityFlag({ flagId, status, adminUserId: req.user.sub }),
  });
}

module.exports = {
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
};
