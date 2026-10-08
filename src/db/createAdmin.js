require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

async function createAdmin() {
  const { ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (
    !ADMIN_EMAIL ||
    !ADMIN_USERNAME ||
    typeof ADMIN_PASSWORD !== "string" ||
    ADMIN_PASSWORD.length < 12
  ) {
    throw new Error(
      "Set ADMIN_EMAIL, ADMIN_USERNAME, and ADMIN_PASSWORD (at least 12 characters) to provision an administrator.",
    );
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await pool.query(
    `INSERT INTO users (email, username, password_hash, role)
     VALUES (LOWER($1), $2, $3, 'admin')
     ON CONFLICT (email) DO UPDATE
       SET username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           role = 'admin'`,
    [ADMIN_EMAIL.trim(), ADMIN_USERNAME.trim(), passwordHash],
  );
  console.log("Administrator account provisioned.");
}

createAdmin()
  .catch((error) => {
    console.error("Could not provision administrator", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
