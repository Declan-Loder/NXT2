-- ============================================================
-- NXT Tournament Registration & Payment Schema
-- Run this in the Supabase SQL Editor (project: sagmjbyrtdindecmeyil)
-- Safe to re-run: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS patterns
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- 1. TOURNAMENTS (ensure base table exists; extend if needed)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tournaments (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  format        text,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('draft', 'open', 'closed', 'live', 'completed')),
  entry_fee     numeric(10,2) NOT NULL DEFAULT 0,
  max_players   integer,
  game          text,
  platform      text,
  starts_at     timestamptz,
  ends_at       timestamptz,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. REGISTRATIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.registrations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     text NOT NULL UNIQUE,           -- e.g. NXT-R-A1B2C3
  tournament_id       bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  player_name         text NOT NULL,
  ea_id               text,
  gamertag            text NOT NULL,
  platform            text NOT NULL DEFAULT 'PC',
  discord_username    text,
  email               text,
  payment_reference   text NOT NULL UNIQUE,           -- e.g. NXT-P-A1B2C3
  payment_amount      numeric(10,2) NOT NULL DEFAULT 0,
  payment_method      text NOT NULL DEFAULT 'free'
                      CHECK (payment_method IN ('free', 'eft', 'card')),
  payment_status      text NOT NULL DEFAULT 'awaiting_payment'
                      CHECK (payment_status IN (
                        'awaiting_payment',
                        'payment_submitted',
                        'pending_verification',
                        'paid',
                        'payment_rejected',
                        'cancelled',
                        'refunded'
                      )),
  admin_notes         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_registrations_tournament
  ON public.registrations (tournament_id);
CREATE INDEX IF NOT EXISTS idx_registrations_status
  ON public.registrations (payment_status);
CREATE INDEX IF NOT EXISTS idx_registrations_email
  ON public.registrations (email);
CREATE INDEX IF NOT EXISTS idx_registrations_created
  ON public.registrations (created_at DESC);

-- Prevent obvious duplicate paid entries for same tournament + EA ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_unique_ea
  ON public.registrations (tournament_id, lower(ea_id))
  WHERE ea_id IS NOT NULL AND ea_id <> '' AND payment_status = 'paid';

-- Prevent obvious duplicate paid entries for same tournament + gamertag
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_unique_gamertag
  ON public.registrations (tournament_id, lower(gamertag))
  WHERE payment_status = 'paid';

-- ------------------------------------------------------------
-- 3. PAYMENTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id         uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  provider                text NOT NULL
                          CHECK (provider IN ('eft', 'paystack', 'payfast', 'yoco', 'other')),
  provider_reference      text,                      -- Paystack reference, bank ref, etc.
  amount                  numeric(10,2) NOT NULL,
  currency                text NOT NULL DEFAULT 'ZAR',
  status                  text NOT NULL DEFAULT 'pending'
                          CHECK (status IN (
                            'pending',
                            'submitted',
                            'verified',
                            'failed',
                            'refunded'
                          )),
  verified_at             timestamptz,
  raw_provider_payload    jsonb,                     -- optional audit of provider response
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_registration
  ON public.payments (registration_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref
  ON public.payments (provider, provider_reference)
  WHERE provider_reference IS NOT NULL AND provider_reference <> '';

-- ------------------------------------------------------------
-- 4. PAYMENT PROOFS (EFT uploads)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_proofs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     uuid NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,
  storage_path        text NOT NULL,                 -- path inside payment-proofs bucket
  file_name           text,
  content_type        text,
  file_size_bytes     integer,
  verification_status text NOT NULL DEFAULT 'pending'
                      CHECK (verification_status IN ('pending', 'accepted', 'rejected')),
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  reviewed_at         timestamptz,
  reviewed_by         text
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_registration
  ON public.payment_proofs (registration_id);

-- ------------------------------------------------------------
-- 5. PAYMENT AUDIT LOG
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  payment_id          uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  action              text NOT NULL,                 -- e.g. status_change, proof_accepted, note_added
  old_status          text,
  new_status          text,
  note                text,
  actor               text,                          -- admin email / 'system' / 'paystack-webhook'
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_registration
  ON public.payment_audit_log (registration_id);
CREATE INDEX IF NOT EXISTS idx_audit_created
  ON public.payment_audit_log (created_at DESC);

-- ------------------------------------------------------------
-- 6. UPDATED_AT TRIGGER
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrations_updated ON public.registrations;
CREATE TRIGGER trg_registrations_updated
  BEFORE UPDATE ON public.registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_payments_updated ON public.payments;
CREATE TRIGGER trg_payments_updated
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_tournaments_updated ON public.tournaments;
CREATE TRIGGER trg_tournaments_updated
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ------------------------------------------------------------
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Tournaments: public can read open/live listings
DROP POLICY IF EXISTS "Public read open tournaments" ON public.tournaments;
CREATE POLICY "Public read open tournaments"
  ON public.tournaments FOR SELECT
  USING (status IN ('open', 'live', 'closed', 'completed'));

-- Registrations: anyone can insert (server + anon form submissions)
DROP POLICY IF EXISTS "Allow registration insert" ON public.registrations;
CREATE POLICY "Allow registration insert"
  ON public.registrations FOR INSERT
  WITH CHECK (true);

-- Registrations: public read is restricted — only service role / admin should list all.
-- For player "my registration" lookups we use service role or filtered email later.
-- Anon SELECT is denied by default (no policy = no access for anon/authenticated unless matched).

-- Payments / proofs / audit: no public policies. All access via service role from serverless functions.

-- ------------------------------------------------------------
-- 8. STORAGE BUCKET (run once; or create via Dashboard → Storage)
-- ------------------------------------------------------------
-- Insert bucket if missing (requires storage schema privileges)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: only service role uploads in practice (API uses service key).
-- Optional: allow authenticated users to upload their own proof path.
DROP POLICY IF EXISTS "Service role full access payment-proofs" ON storage.objects;
-- Prefer managing uploads exclusively through /api with the service role key.
-- If you later want client-side signed uploads, add a narrow policy here.

-- ------------------------------------------------------------
-- 9. HELPER: generate short public IDs (optional RPC)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nxt_generate_code(prefix text DEFAULT 'NXT')
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  END LOOP;
  RETURN prefix || '-' || result;
END;
$$;

-- ============================================================
-- NOTES FOR NXT ADMIN
-- ============================================================
-- 1. After running this SQL, set these Vercel env vars if not already set:
--      SUPABASE_URL
--      SUPABASE_SERVICE_ROLE_KEY
--      PAYSTACK_SECRET_KEY          (for card path)
--      NXT_BANK_NAME                (EFT display)
--      NXT_BANK_ACCOUNT_NAME
--      NXT_BANK_ACCOUNT_NUMBER
--      NXT_BANK_BRANCH_CODE
--      NXT_ADMIN_EMAILS             (comma-separated, for future admin auth)
--
-- 2. Never put the service role key in app.js or any frontend file.
--
-- 3. Existing rows in `registrations` (if any) may need a one-time backfill
--    of registration_id / payment_reference / payment_status before unique
--    constraints are strict. Adjust as needed for your current data.
-- ============================================================
