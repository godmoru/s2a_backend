const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { login, register } = require("../controllers/auth.controller");

const router = express.Router();
router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));

module.exports = router;
