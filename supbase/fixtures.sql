-- ============================================================
-- NXT Fixtures & Results (additive — run after platform-v2.sql)
-- Does not drop or recreate existing tables
-- ============================================================

CREATE TABLE IF NOT EXISTS public.matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_label     text,                          -- e.g. Group A, Quarter-final
  match_number    integer,
  scheduled_at    timestamptz,
  status          text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN (
                    'scheduled', 'live', 'completed', 'forfeit', 'cancelled'
                  )),
  player1_name    text,
  player2_name    text,
  player1_registration_id uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  player2_registration_id uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  player1_score   integer,
  player2_score   integer,
  winner_name     text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_tournament
  ON public.matches (tournament_id, scheduled_at);

CREATE TABLE IF NOT EXISTS public.match_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  submitted_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  player1_score   integer,
  player2_score   integer,
  evidence_url    text,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_standings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   bigint NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_name     text NOT NULL,
  registration_id uuid REFERENCES public.registrations(id) ON DELETE SET NULL,
  wins            integer NOT NULL DEFAULT 0,
  losses          integer NOT NULL DEFAULT 0,
  draws           integer NOT NULL DEFAULT 0,
  points          integer NOT NULL DEFAULT 0,
  rank            integer,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, player_name)
);

DROP TRIGGER IF EXISTS trg_matches_updated ON public.matches;
CREATE TRIGGER trg_matches_updated
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_standings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read matches" ON public.matches;
CREATE POLICY "Public read matches"
  ON public.matches FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read standings" ON public.tournament_standings;
CREATE POLICY "Public read standings"
  ON public.tournament_standings FOR SELECT USING (true);

-- Writes go through service-role API only
-- ============================================================
