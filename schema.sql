-- =========================================================
-- QR Code Attendance System — Initial Schema
-- Run this once against your Neon database (e.g. via the
-- Neon SQL Editor, or `psql "$DATABASE_URL" -f schema.sql`)
-- =========================================================

-- Needed for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS attendees (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    scanned_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Attendance feed is read ordered by scanned_at DESC, so index it.
CREATE INDEX IF NOT EXISTS idx_attendees_scanned_at
    ON attendees (scanned_at DESC);
