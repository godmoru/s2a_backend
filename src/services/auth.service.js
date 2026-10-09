const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { recordAuditEvent } = require("./audit.service");
const { sendMail } = require("./mail.service");

async function registerUser({ username, email, password }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, LOWER($2), $3)
       RETURNING id, participant_id, username, email, role, email_verified_at`,
      [username.trim(), email.trim(), passwordHash],
    );
    const user = {
      id: rows[0].id,
      participantId: rows[0].participant_id,
      username: rows[0].username,
      email: rows[0].email,
      role: rows[0].role,
      emailVerifiedAt: rows[0].email_verified_at,
    };
    await recordAuditEvent(client, {
      actorUserId: user.id,
      action: "participant_registered",
      entityType: "participant",
      entityId: user.id,
    });
    await client.query("COMMIT");
    return { user, token: createToken(user) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loginUser({ email, password }) {
  const { rows } = await pool.query(
    `SELECT id, participant_id, username, email, password_hash, role, email_verified_at
       FROM users WHERE email = LOWER($1)`,
    [email.trim()],
  );
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return null;
  }
  const user = {
    id: rows[0].id,
    participantId: rows[0].participant_id,
    username: rows[0].username,
    email: rows[0].email,
    role: rows[0].role,
    emailVerifiedAt: rows[0].email_verified_at,
  };
  await pool.query(
    `INSERT INTO audit_events (actor_user_id, action, entity_type, entity_id)
     VALUES ($1, 'participant_login', 'participant', $2)`,
    [user.id, String(user.id)],
  );
  return { user, token: createToken(user) };
}

function createToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role || "user" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Always resolves without revealing whether the email is registered.
async function requestPasswordReset(email) {
  const { rows } = await pool.query("SELECT id, email FROM users WHERE email = LOWER($1)", [email.trim()]);
  if (!rows.length) return;
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
    [rows[0].id, hashResetToken(token)],
  );
  const origin = (process.env.FRONTEND_ORIGIN || "http://localhost:3000").split(",")[0].trim();
  await sendMail({
    to: rows[0].email,
    subject: "Reset your S2Answer password",
    text: `Use this link to reset your password (valid for 1 hour):\n\n${origin}/?reset=${token}\n\nIf you did not request this, you can ignore this email.`,
  });
  await recordAuditEvent(pool, {
    actorUserId: rows[0].id,
    action: "password_reset_requested",
    entityType: "participant",
    entityId: rows[0].id,
  });
}

// Returns true when the token was valid and the password was changed.
async function resetPassword(token, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE password_reset_tokens
          SET used_at = NOW()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        RETURNING user_id`,
      [hashResetToken(token)],
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, rows[0].user_id]);
    await client.query(
      "UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL",
      [rows[0].user_id],
    );
    await recordAuditEvent(client, {
      actorUserId: rows[0].user_id,
      action: "password_reset_completed",
      entityType: "participant",
      entityId: rows[0].user_id,
    });
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { loginUser, registerUser, verifyToken, requestPasswordReset, resetPassword };
