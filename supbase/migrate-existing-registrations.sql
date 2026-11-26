-- ============================================================
-- Fix: existing `registrations` table missing payment columns
-- Run this in Supabase SQL Editor, then re-run any failed indexes
-- Safe / additive — does not drop data
-- ============================================================

-- Ensure base columns exist (older NXT tables were minimal)
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS id uuid;

-- If id was never set as PK, leave existing PKs alone; only backfill nulls
UPDATE public.registrations
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS registration_id text,
  ADD COLUMN IF NOT EXISTS ea_id text,
  ADD COLUMN IF NOT EXISTS discord_username text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_amount numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'awaiting_payment',
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS gaming_account_id uuid;

-- Backfill public IDs for old rows that don't have them
UPDATE public.registrations
SET registration_id = 'NXT-R-LEGACY-' || substr(replace(coalesce(id::text, gen_random_uuid()::text), '-', ''), 1, 8)
WHERE registration_id IS NULL OR registration_id = '';

UPDATE public.registrations
SET payment_reference = 'NXT-P-LEGACY-' || substr(replace(coalesce(id::text, gen_random_uuid()::text), '-', ''), 1, 8)
WHERE payment_reference IS NULL OR payment_reference = '';

-- Treat legacy rows without payment info as free/paid so they stay valid
UPDATE public.registrations
SET payment_status = 'paid',
    payment_method = COALESCE(NULLIF(payment_method, ''), 'free'),
    payment_amount = COALESCE(payment_amount, 0)
WHERE payment_status IS NULL
   OR payment_status = 'awaiting_payment'
     AND (payment_reference LIKE 'NXT-P-LEGACY-%');

-- Unique indexes only after backfill (ignore if already present)
CREATE UNIQUE INDEX IF NOT EXISTS registrations_registration_id_key
  ON public.registrations (registration_id);

CREATE UNIQUE INDEX IF NOT EXISTS registrations_payment_reference_key
  ON public.registrations (payment_reference);

CREATE INDEX IF NOT EXISTS idx_registrations_tournament
  ON public.registrations (tournament_id);

CREATE INDEX IF NOT EXISTS idx_registrations_status
  ON public.registrations (payment_status);

CREATE INDEX IF NOT EXISTS idx_registrations_email
  ON public.registrations (email);

CREATE INDEX IF NOT EXISTS idx_registrations_created
  ON public.registrations (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registrations_user
  ON public.registrations (user_id);

-- Optional: attach FK to profiles when platform-v2 has been run
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    BEGIN
      ALTER TABLE public.registrations
        DROP CONSTRAINT IF EXISTS registrations_user_id_fkey;
      ALTER TABLE public.registrations
        ADD CONSTRAINT registrations_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'user_id FK skipped: %', SQLERRM;
    END;
  END IF;
END $$;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'registrations'
ORDER BY ordinal_position;
