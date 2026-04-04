-- ── CLIENTS TABLE ──
-- Run this in the Supabase SQL editor.
-- Stores client contacts per user, tied to auth.uid() (not email).

CREATE TABLE IF NOT EXISTS clients (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_business_name TEXT,
  contact_name         TEXT,
  email                TEXT,
  phone                TEXT,
  address_line_1       TEXT,
  address_line_2       TEXT,
  city                 TEXT,
  state                TEXT,
  postal_code          TEXT,
  notes                TEXT,
  is_archived          BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ROW LEVEL SECURITY ──
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Users can only see and manage their own clients
CREATE POLICY "Users own their clients"
  ON clients
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── UPDATED_AT TRIGGER ──
-- Automatically bumps updated_at on every row update
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── INDEXES ──
CREATE INDEX idx_clients_user_id ON clients (user_id);
CREATE INDEX idx_clients_user_archived ON clients (user_id, is_archived);
