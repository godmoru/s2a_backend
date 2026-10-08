const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { recordAuditEvent } = require("./audit.service");

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

//Reset password

//Reset Password Token Verification


function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { loginUser, registerUser, verifyToken };
