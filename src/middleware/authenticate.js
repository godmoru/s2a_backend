const { verifyToken } = require("../services/auth.service");

function authenticate(req, res, next) {
  const authorization = req.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Sign in to continue." });
  }

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Your session has expired. Sign in again." });
  }
}

module.exports = authenticate;
