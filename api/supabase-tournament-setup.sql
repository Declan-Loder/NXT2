-- Optional setup for the current NXT tournament page.
-- Current schema has tournaments and registrations, but no games table or game column.
-- This adds a game name to each tournament row without deleting or changing existing data.

ALTER TABLE public.tournaments
ADD COLUMN IF NOT EXISTS game_name text;

-- After running this SQL, open Table Editor > tournaments and fill in game_name
-- for each tournament (for example, EA SPORTS FC 26 where appropriate).
-- The website reads tournament name, format, date, status, and game_name.

-- Public tournament listing requires a SELECT policy if RLS is enabled.
-- Review your existing policies before adding a new one. If the page still shows
-- an error, inspect the browser console and Supabase API logs rather than disabling RLS.
