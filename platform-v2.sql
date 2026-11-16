-- ============================================================
-- NXT Platform v2 — Identity, roles, player linking, games
-- Run AFTER schema.sql (payment tables)
-- Safe / idempotent patterns throughout
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- PROFILES (1:1 with auth.users)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        text UNIQUE,
  display_name    text,
  full_name       text,
  email           text,
  country         text DEFAULT 'ZA',
  avatar_url      text,
  bio             text,
  discord_username text,
  account_status  text NOT NULL DEFAULT 'active'
                  CHECK (account_status IN ('active', 'suspended', 'deleted')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (lower(username));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  -- Default role: player
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'player')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------
-- ROLES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role        text NOT NULL
              CHECK (role IN (
                'player', 'creator', 'organiser', 'moderator', 'admin', 'superadmin'
              )),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES public.profiles(id),
  UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);

-- ------------------------------------------------------------
-- PLAYER PROFILES (extends profiles for gamers)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_profiles (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  primary_platform  text,
  primary_game      text,
  gamertag          text,
  ea_id             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- GAMING ACCOUNTS (multiple per player)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gaming_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider        text NOT NULL,  -- ea, steam, psn, xbox, epic, ubisoft, riot, other
  account_id      text NOT NULL,
  display_label   text,
  platform        text,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, account_id)
);

CREATE INDEX IF NOT EXISTS idx_gaming_accounts_user ON public.gaming_accounts (user_id);

-- ------------------------------------------------------------
-- CREATOR PROFILES + APPLICATIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.creator_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  email             text NOT NULL,
  display_name      text NOT NULL,
  country           text,
  bio               text,
  category          text,
  interests         text,
  twitch_url        text,
  youtube_url       text,
  tiktok_url        text,
  instagram_url     text,
  other_links       text,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  admin_notes       text,
  reviewed_at       timestamptz,
  reviewed_by       uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_profiles (
  user_id           uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  display_name      text NOT NULL,
  slug              text UNIQUE,
  bio               text,
  category          text,
  cover_url         text,
  avatar_url        text,
  twitch_url        text,
  youtube_url       text,
  tiktok_url        text,
  instagram_url     text,
  other_links       jsonb DEFAULT '[]'::jsonb,
  verification_status text NOT NULL DEFAULT 'approved'
                      CHECK (verification_status IN ('pending', 'approved', 'suspended')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- GAMES (admin-managed, not hardcoded)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.games (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  name            text NOT NULL,
  short_name      text,
  publisher       text,
  cover_url       text,
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.game_platforms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
  platform        text NOT NULL,
  UNIQUE (game_id, platform)
);

-- Seed common games (idempotent)
INSERT INTO public.games (slug, name, short_name, sort_order) VALUES
  ('ea-fc', 'EA Sports FC', 'FC', 10),
  ('fortnite', 'Fortnite', 'Fortnite', 20),
  ('rocket-league', 'Rocket League', 'RL', 30),
  ('valorant', 'Valorant', 'VAL', 40),
  ('cod', 'Call of Duty', 'COD', 50),
  ('r6', 'Rainbow Six Siege', 'R6', 60),
  ('mk', 'Mortal Kombat', 'MK', 70)
ON CONFLICT (slug) DO NOTHING;

-- ------------------------------------------------------------
-- EXTEND TOURNAMENTS
-- ------------------------------------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS game_id uuid REFERENCES public.games(id),
  ADD COLUMN IF NOT EXISTS organiser_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS registration_opens_at timestamptz,
  ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS prize_description text,
  ADD COLUMN IF NOT EXISTS rules text,
  ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS approval_status text DEFAULT 'approved';

-- Ensure status values remain compatible
-- (existing check may already exist)

-- ------------------------------------------------------------
-- EXTEND REGISTRATIONS — link to auth user
-- ------------------------------------------------------------
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gaming_account_id uuid REFERENCES public.gaming_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_user
  ON public.registrations (user_id);

-- One paid registration per user per tournament (when user_id present)
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_user_tournament_paid
  ON public.registrations (tournament_id, user_id)
  WHERE user_id IS NOT NULL AND payment_status = 'paid';

-- ------------------------------------------------------------
-- NOTIFICATIONS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type            text NOT NULL,
  title           text NOT NULL,
  body            text,
  link            text,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON public.notifications (user_id, created_at DESC);

-- ------------------------------------------------------------
-- ANNOUNCEMENTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  tournament_id   bigint REFERENCES public.tournaments(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL,
  visibility      text NOT NULL DEFAULT 'public',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- AUDIT (general platform actions; payment_audit_log already exists)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action          text NOT NULL,
  entity_type     text,
  entity_id       text,
  meta            jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- UPDATED_AT triggers
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_player_profiles_updated ON public.player_profiles;
CREATE TRIGGER trg_player_profiles_updated
  BEFORE UPDATE ON public.player_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_creator_profiles_updated ON public.creator_profiles;
CREATE TRIGGER trg_creator_profiles_updated
  BEFORE UPDATE ON public.creator_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gaming_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Profiles: public read of active accounts; users update own
DROP POLICY IF EXISTS "Public read active profiles" ON public.profiles;
CREATE POLICY "Public read active profiles"
  ON public.profiles FOR SELECT
  USING (account_status = 'active');

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Roles: users can read own roles
DROP POLICY IF EXISTS "Users read own roles" ON public.user_roles;
CREATE POLICY "Users read own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- Player profiles
DROP POLICY IF EXISTS "Public read player profiles" ON public.player_profiles;
CREATE POLICY "Public read player profiles"
  ON public.player_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users manage own player profile" ON public.player_profiles;
CREATE POLICY "Users manage own player profile"
  ON public.player_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Gaming accounts
DROP POLICY IF EXISTS "Users manage own gaming accounts" ON public.gaming_accounts;
CREATE POLICY "Users manage own gaming accounts"
  ON public.gaming_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Public read gaming accounts" ON public.gaming_accounts;
CREATE POLICY "Public read gaming accounts"
  ON public.gaming_accounts FOR SELECT USING (true);

-- Creator profiles public read
DROP POLICY IF EXISTS "Public read creator profiles" ON public.creator_profiles;
CREATE POLICY "Public read creator profiles"
  ON public.creator_profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Creators update own profile" ON public.creator_profiles;
CREATE POLICY "Creators update own profile"
  ON public.creator_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Games public read
DROP POLICY IF EXISTS "Public read games" ON public.games;
CREATE POLICY "Public read games"
  ON public.games FOR SELECT USING (is_active = true);

-- Notifications: own only
DROP POLICY IF EXISTS "Users read own notifications" ON public.notifications;
CREATE POLICY "Users read own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own notifications" ON public.notifications;
CREATE POLICY "Users update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Registrations: owners can read their own (when user_id set)
DROP POLICY IF EXISTS "Users read own registrations" ON public.registrations;
CREATE POLICY "Users read own registrations"
  ON public.registrations FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================
-- NOTES
-- ============================================================
-- 1. Existing registration rows without user_id remain valid (guest/legacy).
-- 2. After deploy, players who register while logged in get user_id set.
-- 3. Claim-by-email for legacy rows can be added as a secure admin/player flow later.
-- 4. Assign admin: INSERT INTO user_roles (user_id, role) VALUES ('<uuid>', 'admin');
-- ============================================================
