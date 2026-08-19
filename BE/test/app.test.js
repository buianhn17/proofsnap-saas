require("dotenv").config();

const assert = require("node:assert/strict");
const test = require("node:test");
const request = require("supertest");
const { loadEnv } = require("../src/config/env");

loadEnv();
const { createApp } = require("../src/app");
const app = createApp();

test("GET / returns a running backend message", async () => {
  const response = await request(app).get("/");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.message, "LensProof backend đang chạy");
});

test("unknown routes return a stable 404 response", async () => {
  const response = await request(app).get("/api/does-not-exist");

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "NOT_FOUND");
});

test("protected routes reject requests without a session", async () => {
  const response = await request(app).get("/api/auth/me");

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "Chưa đăng nhập");
});

test("Drive routes require the photographer session", async () => {
  const response = await request(app).get("/api/drive/status");

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "Chưa đăng nhập");
});

test("Album routes require the photographer session", async () => {
  const response = await request(app).get("/api/albums");

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "Chưa đăng nhập");
});

test("Photo routes require the photographer session", async () => {
  const response = await request(app).get("/api/albums/00000000-0000-0000-0000-000000000000/photos");

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "Chưa đăng nhập");
});

test("Client album routes require a client PIN session", async () => {
  const response = await request(app).get("/api/public/albums/00000000-0000-0000-0000-000000000000");

  assert.equal(response.statusCode, 401);
  assert.equal(response.body.error, "CLIENT_NOT_AUTHENTICATED");
});

test("Swagger documents the Drive endpoints and cookie auth", async () => {
  const response = await request(app).get("/api-docs/");

  assert.equal(response.statusCode, 200);
  const swaggerSpec = require("../src/config/swagger");
  assert.ok(swaggerSpec.paths["/api/drive/status"]);
  assert.ok(swaggerSpec.paths["/api/drive/setup"]);
  assert.ok(swaggerSpec.paths["/api/albums"]);
  assert.ok(swaggerSpec.paths["/api/albums/{albumId}"]);
  assert.ok(swaggerSpec.paths["/api/albums/{albumId}/photos"]);
  assert.ok(swaggerSpec.paths["/api/public/albums/{albumId}/verify-pin"]);
  assert.ok(swaggerSpec.paths["/api/public/albums/{albumId}"]);
  assert.ok(swaggerSpec.components.schemas.CreateAlbumRequest);
  assert.ok(swaggerSpec.components.schemas.UploadPhotoRequest);
  assert.ok(swaggerSpec.components.schemas.ClientAccessRequest);
  assert.ok(swaggerSpec.components.securitySchemes.cookieAuth);
  assert.ok(swaggerSpec.components.securitySchemes.clientCookieAuth);
});

test("health check confirms database connectivity", async () => {
  const response = await request(app).get("/api/health");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.database, "connected");
});
