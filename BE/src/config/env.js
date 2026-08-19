const requiredEnv = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "CLIENT_URL",
];

function loadEnv() {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY)) {
    throw new Error("ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
  }

  if (!Number.isInteger(Number(process.env.PORT || 3000))) {
    throw new Error("PORT must be a valid number");
  }

  try {
    new URL(process.env.CLIENT_URL);
  } catch {
    throw new Error("CLIENT_URL must be a valid URL");
  }

  return process.env;
}

module.exports = { loadEnv };
