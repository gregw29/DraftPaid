-- ── INVOICES TABLE ──
-- Run this in the Supabase SQL editor.
-- Stores invoice history per user.
-- user_id = auth.uid(); user_email stored for webhook fallback matching.

CREATE TABLE IF NOT EXISTS invoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email        TEXT NOT NULL,
  invoice_number    TEXT NOT NULL,
  invoice_date      DATE,
  due_date          DATE,
  client_name       TEXT,
  client_email      TEXT,
  line_items        JSONB,
  subtotal          NUMERIC(12,2),
  tax_rate          NUMERIC(5,2),
  tax_amount        NUMERIC(12,2),
  discount          NUMERIC(12,2),
  total             NUMERIC(12,2),
  currency          TEXT DEFAULT '$',
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'unpaid', 'paid')),
  pay_now_enabled   BOOLEAN DEFAULT false,
  payment_url       TEXT,
  stripe_session_id TEXT,
  paid_at           TIMESTAMPTZ,
  is_deleted        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── UNIQUE INDEX for upsert on (user_id, invoice_number) ──
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_user_invoice
  ON invoices (user_id, invoice_number);

-- ── ROW LEVEL SECURITY ──
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their invoices"
  ON invoices
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── UPDATED_AT TRIGGER ──
-- Reuses set_updated_at() created by clients-table.sql.
-- If that migration hasn't been run yet, create it first:
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── INDEXES ──
CREATE INDEX IF NOT EXISTS idx_invoices_user_id  ON invoices (user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_session  ON invoices (stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices (user_id, status);
