-- Initial schema migration.
-- Run with psql; the included schema file remains the single SQL source of truth.
\ir /docker-entrypoint-initdb.d/03-lensproof_schema.sql
