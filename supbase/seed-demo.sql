-- Optional demo tournament (safe to run once)
-- Requires schema.sql + platform-v2.sql

INSERT INTO public.tournaments (
  name, format, status, entry_fee, max_players, platform, region, description, visibility, approval_status
)
SELECT
  'NXT Community Open — Demo',
  'Single elimination',
  'open',
  0,
  32,
  'Cross-play',
  'South Africa',
  'Demo tournament for platform testing. Free entry. Replace or close when live events start.',
  'public',
  'approved'
WHERE NOT EXISTS (
  SELECT 1 FROM public.tournaments WHERE name = 'NXT Community Open — Demo'
);

-- Link game if ea-fc seed exists
UPDATE public.tournaments t
SET game_id = g.id
FROM public.games g
WHERE t.name = 'NXT Community Open — Demo'
  AND g.slug = 'ea-fc'
  AND t.game_id IS NULL;
