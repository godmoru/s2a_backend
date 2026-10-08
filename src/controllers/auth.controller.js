const { loginUser, registerUser } = require("../services/auth.service");

async function register(req, res) {
  const { username, email, password } = req.body || {};
  if (
    typeof username !== "string" ||
    username.trim().length < 2 ||
    username.trim().length > 40 ||
    typeof email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    typeof password !== "string" ||
    password.length < 8
  ) {
    return res.status(400).json({
      error: "Provide a username (2–40 characters), valid email, and password (at least 8 characters).",
    });
  }

  try {
    const result = await registerUser({ username, email, password });
    return res.status(201).json(result);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "That username or email is already registered." });
    }
    throw error;
  }
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Enter your email and password." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }
  const result = await loginUser({ email, password });
  if (!result) return res.status(401).json({ error: "Email or password is incorrect." });
  return res.json(result);
}

module.exports = { login, register };
