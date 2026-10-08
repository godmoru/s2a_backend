require("dotenv").config();
const bcrypt = require("bcryptjs");
const fs = require("node:fs");
const path = require("node:path");
const pool = require("./pool");
const { recordAuditEvent } = require("../services/audit.service");

function configuredAdmins() {
  let admins;
  const configuredFile = process.env.ADMIN_SEED_USERS_FILE;
  const adminsFile = configuredFile
    ? path.resolve(__dirname, configuredFile)
    : path.join(__dirname, "admin-seed-users.json");
  if (fs.existsSync(adminsFile)) {
    try {
      admins = JSON.parse(fs.readFileSync(adminsFile, "utf8"));
    } catch {
      throw new Error(`The administrator credential file must contain valid JSON: ${adminsFile}`);
    }
  } else if (configuredFile) {
    throw new Error(`Administrator credential file was not found: ${adminsFile}`);
  } else if (process.env.ADMIN_SEED_USERS) {
    try {
      admins = JSON.parse(process.env.ADMIN_SEED_USERS);
    } catch {
      throw new Error("ADMIN_SEED_USERS must be valid JSON containing four administrator records.");
    }
  } else {
    throw new Error(
      `Add four administrator records to ${adminsFile}, or set ADMIN_SEED_USERS_FILE to a JSON file.`,
    );
  }
  if (!Array.isArray(admins) || admins.length !== 4) {
    throw new Error("The administrator credential JSON must contain exactly four records.");
  }

  const normalized = admins.map((admin) => ({
    email: typeof admin.email === "string" ? admin.email.trim().toLowerCase() : "",
    username: typeof admin.username === "string" ? admin.username.trim() : "",
    password: typeof admin.password === "string" ? admin.password : "",
  }));
  const emails = new Set();
  const usernames = new Set();
  for (const admin of normalized) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(admin.email)) {
      throw new Error("Each additional administrator needs a valid, unique email address.");
    }
    if (admin.username.length < 3 || admin.username.length > 40) {
      throw new Error("Each additional administrator username must be 3 to 40 characters.");
    }
    if (admin.password.length === 0) {
      throw new Error("Each additional administrator password must not be empty.");
    }
    if (emails.has(admin.email) || usernames.has(admin.username)) {
      throw new Error("Additional administrator emails and usernames must be unique.");
    }
    emails.add(admin.email);
    usernames.add(admin.username);
  }
  return normalized;
}

async function seedAdmins() {
  const admins = configuredAdmins();
  const hashedAdmins = await Promise.all(
    admins.map(async (admin) => ({
      ...admin,
      passwordHash: await bcrypt.hash(admin.password, 12),
    })),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const admin of hashedAdmins) {
      const { rows: existing } = await client.query(
        `SELECT id, email, username, role FROM users
          WHERE LOWER(email) = $1 OR username = $2
          FOR UPDATE`,
        [admin.email, admin.username],
      );
      const emailAccount = existing.find((user) => user.email.toLowerCase() === admin.email);
      if (emailAccount && emailAccount.role !== "admin") {
        throw new Error(`Refusing to promote the existing account for ${admin.email} to administrator.`);
      }
      if (existing.some((user) => !emailAccount || String(user.id) !== String(emailAccount.id))) {
        throw new Error(`An account already uses the username or email for ${admin.email}.`);
      }

      const { rows } = emailAccount
        ? await client.query(
          `UPDATE users SET username = $1, password_hash = $2
            WHERE id = $3 RETURNING id`,
          [admin.username, admin.passwordHash, emailAccount.id],
        )
        : await client.query(
          `INSERT INTO users (email, username, password_hash, role)
           VALUES ($1, $2, $3, 'admin') RETURNING id`,
          [admin.email, admin.username, admin.passwordHash],
        );
      await recordAuditEvent(client, {
        actorUserId: null,
        action: "admin_account_seeded",
        entityType: "user",
        entityId: rows[0].id,
        metadata: { email: admin.email, username: admin.username, provisionedBySeed: true },
      });
    }
    await client.query("COMMIT");
    console.log("Four additional administrator accounts provisioned; credentials were not printed.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

seedAdmins()
  .catch((error) => {
    console.error("Could not seed additional administrators", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
