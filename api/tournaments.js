/**
 * POST /api/tournaments
 * Actions: create | list_mine | publish | set_status
 *
 * Auth: Authorization Bearer <supabase access token>
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * create body: {
 *   action: 'create',
 *   name, format?, description?, entry_fee?, max_players?,
 *   platform?, region?, game_slug?, starts_at?,
 *   registration_closes_at?, prize_description?, rules?,
 *   status?: 'draft' | 'open'  // default draft
 * }
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Tournament service is not configured.' });
  }

  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return res.status(401).json({ error: 'Sign in required.' });
  }
  const jwt = authHeader.slice(7).trim();

  let user;
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid or expired session.' });
    }
    user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Invalid session.' });
  } catch (e) {
    console.error(e);
    return res.status(401).json({ error: 'Could not verify session.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || 'create').toLowerCase();
  const clean = (v, max = 500) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  // Load roles for permission checks
  const rolesRes = await fetch(
    `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${user.id}&select=role`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  const roleRows = rolesRes.ok ? await rolesRes.json() : [];
  const roles = new Set(
    (Array.isArray(roleRows) ? roleRows : []).map((r) => r.role)
  );
  // Also treat approved creator_profiles as creator capability
  const cpRes = await fetch(
    `${supabaseUrl}/rest/v1/creator_profiles?user_id=eq.${user.id}&select=user_id,verification_status`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  const cpRows = cpRes.ok ? await cpRes.json() : [];
  const isApprovedCreator =
    Array.isArray(cpRows) &&
    cpRows.some((c) => c.verification_status === 'approved');

  const canOrganise =
    roles.has('creator') ||
    roles.has('organiser') ||
    roles.has('admin') ||
    roles.has('superadmin') ||
    isApprovedCreator;

  try {
    if (action === 'list_mine') {
      const q = `${supabaseUrl}/rest/v1/tournaments?organiser_id=eq.${user.id}&select=*&order=created_at.desc`;
      const r = await fetch(q, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      if (!r.ok) {
        console.error(await r.text());
        return res.status(502).json({ error: 'Could not load tournaments.' });
      }
      const tournaments = await r.json();
      return res.status(200).json({ success: true, tournaments, roles: [...roles] });
    }

    if (action === 'create') {
      if (!canOrganise) {
        return res.status(403).json({
          error:
            'Creator or organiser role required. Apply as a creator or ask an admin to grant access.',
        });
      }

      const name = clean(body.name, 180);
      if (!name) {
        return res.status(400).json({ error: 'Tournament name is required.' });
      }

      const entryFee = Number(body.entry_fee);
      const fee = Number.isFinite(entryFee) && entryFee >= 0 ? entryFee : 0;
      const maxPlayers = Number(body.max_players);
      const statusIn = clean(body.status, 20).toLowerCase();
      const status = ['draft', 'open'].includes(statusIn) ? statusIn : 'draft';

      let gameId = null;
      const gameSlug = clean(body.game_slug, 80);
      if (gameSlug) {
        const gRes = await fetch(
          `${supabaseUrl}/rest/v1/games?slug=eq.${encodeURIComponent(gameSlug)}&select=id&limit=1`,
          {
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
            },
          }
        );
        if (gRes.ok) {
          const games = await gRes.json();
          if (Array.isArray(games) && games[0]) gameId = games[0].id;
        }
      }

      const row = {
        name,
        format: clean(body.format, 120) || null,
        description: clean(body.description, 5000) || null,
        entry_fee: fee,
        max_players:
          Number.isFinite(maxPlayers) && maxPlayers > 0 ? Math.floor(maxPlayers) : null,
        platform: clean(body.platform, 40) || null,
        region: clean(body.region, 80) || null,
        game_id: gameId,
        organiser_id: user.id,
        starts_at: body.starts_at ? String(body.starts_at) : null,
        registration_closes_at: body.registration_closes_at
          ? String(body.registration_closes_at)
          : null,
        prize_description: clean(body.prize_description, 2000) || null,
        rules: clean(body.rules, 8000) || null,
        status,
        visibility: 'public',
        // Creators publish to open only if admin; default approved for draft/open by organisers
        approval_status: roles.has('admin') || roles.has('superadmin') ? 'approved' : 'approved',
      };

      const insertRes = await fetch(`${supabaseUrl}/rest/v1/tournaments`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify(row),
      });

      if (!insertRes.ok) {
        const errText = await insertRes.text();
        console.error('Tournament insert failed', errText);
        return res.status(502).json({
          error: 'Could not create tournament. Ensure migrations are applied.',
        });
      }

      const rows = await insertRes.json();
      const tournament = Array.isArray(rows) ? rows[0] : rows;

      await fetch(`${supabaseUrl}/rest/v1/audit_logs`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actor_id: user.id,
          action: 'tournament_created',
          entity_type: 'tournament',
          entity_id: String(tournament.id),
          meta: { name, status },
        }),
      }).catch(() => {});

      return res.status(201).json({
        success: true,
        tournament,
        message:
          status === 'open'
            ? 'Tournament created and open for registration.'
            : 'Tournament saved as draft.',
      });
    }

    if (action === 'set_status') {
      if (!canOrganise) {
        return res.status(403).json({ error: 'Not authorised.' });
      }
      const tournamentId = Number(body.tournament_id);
      const newStatus = clean(body.status, 20).toLowerCase();
      if (!tournamentId || !['draft', 'open', 'closed', 'live', 'completed'].includes(newStatus)) {
        return res.status(400).json({ error: 'Valid tournament_id and status required.' });
      }

      // Ownership or admin
      const tRes = await fetch(
        `${supabaseUrl}/rest/v1/tournaments?id=eq.${tournamentId}&select=id,organiser_id`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const tRows = tRes.ok ? await tRes.json() : [];
      const t = Array.isArray(tRows) ? tRows[0] : null;
      if (!t) return res.status(404).json({ error: 'Tournament not found.' });
      const isAdmin = roles.has('admin') || roles.has('superadmin');
      if (t.organiser_id !== user.id && !isAdmin) {
        return res.status(403).json({ error: 'You can only manage your own tournaments.' });
      }

      const patch = await fetch(
        `${supabaseUrl}/rest/v1/tournaments?id=eq.${tournamentId}`,
        {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify({ status: newStatus }),
        }
      );
      if (!patch.ok) {
        console.error(await patch.text());
        return res.status(502).json({ error: 'Could not update status.' });
      }
      const updated = await patch.json();
      return res.status(200).json({
        success: true,
        tournament: Array.isArray(updated) ? updated[0] : updated,
      });
    }

    if (action === 'list_games') {
      const g = await fetch(
        `${supabaseUrl}/rest/v1/games?is_active=eq.true&select=slug,name,short_name&order=sort_order.asc`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const games = g.ok ? await g.json() : [];
      return res.status(200).json({ success: true, games });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('tournaments API', err);
    return res.status(500).json({ error: 'Tournament request failed.' });
  }
};
