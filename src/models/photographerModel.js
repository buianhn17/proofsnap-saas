const pool = require("../config/db");

async function findByGoogleId(googleId) {
  const result = await pool.query(
    "SELECT * FROM photographers WHERE google_id = $1",
    [googleId]
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await pool.query(
    "SELECT * FROM photographers WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

async function createPhotographer({ googleId, email, displayName, encryptedRefreshToken }) {
  const result = await pool.query(
    `INSERT INTO photographers (google_id, email, display_name, oauth_refresh_token_encrypted)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [googleId, email, displayName, encryptedRefreshToken]
  );
  return result.rows[0];
}

async function updateRefreshToken(photographerId, encryptedRefreshToken) {
  await pool.query(
    "UPDATE photographers SET oauth_refresh_token_encrypted = $1, updated_at = now() WHERE id = $2",
    [encryptedRefreshToken, photographerId]
  );
}

module.exports = {
  findByGoogleId,
  findById,
  createPhotographer,
  updateRefreshToken,
};
