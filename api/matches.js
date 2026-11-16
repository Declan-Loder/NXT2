/**
 * POST /api/matches
 * actions: list | create | update_result | set_status
 *
 * list: public (no auth required) — body: { action, tournament_id }
 * create / update_result / set_status: Bearer auth + organiser/admin
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Matches service not configured.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || 'list').toLowerCase();
  const clean = (v, max = 200) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  const headersSvc = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    if (action === 'list') {
      const tournamentId = Number(body.tournament_id);
      if (!tournamentId) {
        return res.status(400).json({ error: 'tournament_id required.' });
      }
      const r = await fetch(
        `${supabaseUrl}/rest/v1/matches?tournament_id=eq.${tournamentId}&select=*&order=match_number.asc.nullslast,scheduled_at.asc.nullslast`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      if (!r.ok) {
        const err = await r.text();
        // Table may not exist yet
        if (/relation|does not exist/i.test(err)) {
          return res.status(200).json({
            success: true,
            matches: [],
            message: 'Run supabase/fixtures.sql to enable fixtures.',
          });
        }
        console.error(err);
        return res.status(502).json({ error: 'Could not load matches.' });
      }
      return res.status(200).json({ success: true, matches: await r.json() });
    }

    // Auth required for write actions
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      return res.status(401).json({ error: 'Sign in required.' });
    }
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${authHeader.slice(7).trim()}`,
      },
    });
    if (!userRes.ok) {
      return res.status(401).json({ error: 'Invalid session.' });
    }
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Invalid session.' });

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
    const roles = new Set((Array.isArray(roleRows) ? roleRows : []).map((r) => r.role));
    const isAdmin = roles.has('admin') || roles.has('superadmin');

    async function assertCanManage(tournamentId) {
      const tRes = await fetch(
        `${supabaseUrl}/rest/v1/tournaments?id=eq.${tournamentId}&select=id,organiser_id`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const rows = tRes.ok ? await tRes.json() : [];
      const t = Array.isArray(rows) ? rows[0] : null;
      if (!t) return { ok: false, error: 'Tournament not found.', status: 404 };
      if (t.organiser_id !== user.id && !isAdmin) {
        return { ok: false, error: 'Not authorised to manage this tournament.', status: 403 };
      }
      return { ok: true, tournament: t };
    }

    if (action === 'create') {
      const tournamentId = Number(body.tournament_id);
      if (!tournamentId) {
        return res.status(400).json({ error: 'tournament_id required.' });
      }
      const gate = await assertCanManage(tournamentId);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

      const row = {
        tournament_id: tournamentId,
        round_label: clean(body.round_label, 80) || null,
        match_number: Number(body.match_number) || null,
        scheduled_at: body.scheduled_at ? String(body.scheduled_at) : null,
        status: 'scheduled',
        player1_name: clean(body.player1_name, 120) || null,
        player2_name: clean(body.player2_name, 120) || null,
        notes: clean(body.notes, 1000) || null,
      };

      const ins = await fetch(`${supabaseUrl}/rest/v1/matches`, {
        method: 'POST',
        headers: headersSvc,
        body: JSON.stringify(row),
      });
      if (!ins.ok) {
        console.error(await ins.text());
        return res.status(502).json({
          error: 'Could not create match. Ensure fixtures.sql was applied.',
        });
      }
      const rows = await ins.json();
      return res.status(201).json({
        success: true,
        match: Array.isArray(rows) ? rows[0] : rows,
      });
    }

    if (action === 'update_result') {
      const matchId = clean(body.match_id, 80);
      if (!matchId) return res.status(400).json({ error: 'match_id required.' });

      const mRes = await fetch(
        `${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&select=*`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const mRows = mRes.ok ? await mRes.json() : [];
      const match = Array.isArray(mRows) ? mRows[0] : null;
      if (!match) return res.status(404).json({ error: 'Match not found.' });

      const gate = await assertCanManage(match.tournament_id);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

      const p1 = Number(body.player1_score);
      const p2 = Number(body.player2_score);
      if (!Number.isFinite(p1) || !Number.isFinite(p2)) {
        return res.status(400).json({ error: 'Valid scores required.' });
      }

      let winner = null;
      if (p1 > p2) winner = match.player1_name;
      else if (p2 > p1) winner = match.player2_name;

      const patch = await fetch(
        `${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`,
        {
          method: 'PATCH',
          headers: headersSvc,
          body: JSON.stringify({
            player1_score: p1,
            player2_score: p2,
            winner_name: winner,
            status: 'completed',
          }),
        }
      );
      if (!patch.ok) {
        console.error(await patch.text());
        return res.status(502).json({ error: 'Could not update result.' });
      }
      const updated = await patch.json();

      // Best-effort standing updates
      await updateStandings(supabaseUrl, serviceKey, match.tournament_id, match, p1, p2);

      return res.status(200).json({
        success: true,
        match: Array.isArray(updated) ? updated[0] : updated,
      });
    }

    if (action === 'set_status') {
      const matchId = clean(body.match_id, 80);
      const status = clean(body.status, 20).toLowerCase();
      if (!matchId || !['scheduled', 'live', 'completed', 'forfeit', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'match_id and valid status required.' });
      }
      const mRes = await fetch(
        `${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}&select=*`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const mRows = mRes.ok ? await mRes.json() : [];
      const match = Array.isArray(mRows) ? mRows[0] : null;
      if (!match) return res.status(404).json({ error: 'Match not found.' });
      const gate = await assertCanManage(match.tournament_id);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

      const patch = await fetch(
        `${supabaseUrl}/rest/v1/matches?id=eq.${encodeURIComponent(matchId)}`,
        {
          method: 'PATCH',
          headers: headersSvc,
          body: JSON.stringify({ status }),
        }
      );
      if (!patch.ok) {
        return res.status(502).json({ error: 'Could not update status.' });
      }
      const updated = await patch.json();
      return res.status(200).json({
        success: true,
        match: Array.isArray(updated) ? updated[0] : updated,
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Matches request failed.' });
  }
};

async function updateStandings(supabaseUrl, serviceKey, tournamentId, match, p1, p2) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  async function bump(name, win, loss, draw) {
    if (!name) return;
    // Read existing
    const r = await fetch(
      `${supabaseUrl}/rest/v1/tournament_standings?tournament_id=eq.${tournamentId}&player_name=eq.${encodeURIComponent(name)}&select=*`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    const rows = r.ok ? await r.json() : [];
    const existing = Array.isArray(rows) ? rows[0] : null;
    const wins = (existing?.wins || 0) + win;
    const losses = (existing?.losses || 0) + loss;
    const draws = (existing?.draws || 0) + draw;
    const points = wins * 3 + draws;
    if (existing) {
      await fetch(
        `${supabaseUrl}/rest/v1/tournament_standings?id=eq.${existing.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ wins, losses, draws, points }),
        }
      );
    } else {
      await fetch(`${supabaseUrl}/rest/v1/tournament_standings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tournament_id: tournamentId,
          player_name: name,
          wins,
          losses,
          draws,
          points,
        }),
      });
    }
  }

  if (p1 > p2) {
    await bump(match.player1_name, 1, 0, 0);
    await bump(match.player2_name, 0, 1, 0);
  } else if (p2 > p1) {
    await bump(match.player2_name, 1, 0, 0);
    await bump(match.player1_name, 0, 1, 0);
  } else {
    await bump(match.player1_name, 0, 0, 1);
    await bump(match.player2_name, 0, 0, 1);
  }
}
