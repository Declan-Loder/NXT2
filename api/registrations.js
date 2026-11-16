/**
 * POST /api/registrations
 * Creates a tournament registration with unique registration_id + payment_reference.
 *
 * Body: {
 *   tournament_id: number,
 *   player_name: string,
 *   ea_id?: string,
 *   gamertag: string,
 *   platform?: string,
 *   discord_username?: string,
 *   email?: string,
 *   payment_method?: 'free' | 'eft' | 'card'   // default inferred from tournament fee
 * }
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Never exposes service role to the client.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error:
        'Registration service is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on Vercel.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  const clean = (v, max = 120) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  // Optional authenticated user (Supabase JWT from client)
  let authUserId = null;
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const jwt = authHeader.slice(7).trim();
    if (jwt) {
      try {
        const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${jwt}`,
          },
        });
        if (userRes.ok) {
          const user = await userRes.json();
          if (user && user.id) authUserId = user.id;
        }
      } catch (e) {
        console.error('Auth user resolve failed', e);
      }
    }
  }

  const tournamentId = Number(body.tournament_id);
  const playerName = clean(body.player_name, 120);
  const eaId = clean(body.ea_id, 80);
  const gamertag = clean(body.gamertag, 80);
  const platform = clean(body.platform, 40) || 'PC';
  const discordUsername = clean(body.discord_username, 80);
  const email = clean(body.email, 254).toLowerCase();
  let paymentMethod = clean(body.payment_method, 20).toLowerCase();

  if (!Number.isFinite(tournamentId) || tournamentId < 1) {
    return res.status(400).json({ error: 'A valid tournament is required.' });
  }
  if (!playerName || !gamertag) {
    return res.status(400).json({ error: 'Player name and gamertag are required.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const allowedPlatforms = ['PC', 'PlayStation', 'Xbox', 'Mobile', 'Switch', 'Other'];
  const platformNorm = allowedPlatforms.find(
    (p) => p.toLowerCase() === platform.toLowerCase()
  ) || 'PC';

  try {
    // Load tournament (fee + status)
    const tRes = await fetch(
      `${supabaseUrl}/rest/v1/tournaments?id=eq.${tournamentId}&select=id,name,entry_fee,status,max_players`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );

    if (!tRes.ok) {
      console.error('Tournament fetch failed', await tRes.text());
      return res.status(502).json({ error: 'Could not load tournament details.' });
    }

    const tournaments = await tRes.json();
    const tournament = Array.isArray(tournaments) ? tournaments[0] : null;

    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }
    if (!['open', 'live'].includes(String(tournament.status))) {
      return res.status(400).json({
        error: 'This tournament is not open for registration.',
      });
    }

    const entryFee = Number(tournament.entry_fee) || 0;

    // Infer payment method when not supplied
    if (!paymentMethod || !['free', 'eft', 'card'].includes(paymentMethod)) {
      paymentMethod = entryFee >= 1 ? 'eft' : 'free';
    }
    if (entryFee < 1) paymentMethod = 'free';
    if (entryFee >= 1 && paymentMethod === 'free') {
      return res.status(400).json({
        error: 'This tournament requires payment. Choose EFT or card.',
      });
    }
    if (entryFee >= 1 && !email) {
      return res.status(400).json({
        error: 'Email is required for paid registrations.',
      });
    }

    // Optional capacity check
    if (tournament.max_players && Number(tournament.max_players) > 0) {
      const countRes = await fetch(
        `${supabaseUrl}/rest/v1/registrations?tournament_id=eq.${tournamentId}&payment_status=eq.paid&select=id`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            Prefer: 'count=exact',
          },
        }
      );
      const contentRange = countRes.headers.get('content-range') || '';
      const match = contentRange.match(/\/(\d+)/);
      const paidCount = match ? Number(match[1]) : 0;
      if (paidCount >= Number(tournament.max_players)) {
        return res.status(400).json({
          error: 'This tournament is full. No spaces remaining.',
        });
      }
    }

    // Duplicate protection (soft check before insert)
    if (authUserId) {
      const dupUser = await fetch(
        `${supabaseUrl}/rest/v1/registrations?tournament_id=eq.${tournamentId}&user_id=eq.${authUserId}&payment_status=eq.paid&select=id&limit=1`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const userRows = await dupUser.json();
      if (Array.isArray(userRows) && userRows.length > 0) {
        return res.status(409).json({
          error: 'You are already registered and confirmed for this tournament.',
        });
      }
    }

    if (eaId) {
      const dupEa = await fetch(
        `${supabaseUrl}/rest/v1/registrations?tournament_id=eq.${tournamentId}&ea_id=ilike.${encodeURIComponent(eaId)}&payment_status=eq.paid&select=id&limit=1`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const eaRows = await dupEa.json();
      if (Array.isArray(eaRows) && eaRows.length > 0) {
        return res.status(409).json({
          error: 'An entry with this EA ID is already confirmed for this tournament.',
        });
      }
    }

    const dupGt = await fetch(
      `${supabaseUrl}/rest/v1/registrations?tournament_id=eq.${tournamentId}&gamertag=ilike.${encodeURIComponent(gamertag)}&payment_status=eq.paid&select=id&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    const gtRows = await dupGt.json();
    if (Array.isArray(gtRows) && gtRows.length > 0) {
      return res.status(409).json({
        error: 'An entry with this gamertag is already confirmed for this tournament.',
      });
    }

    const registrationId = generateCode('NXT-R');
    const paymentReference = generateCode('NXT-P');

    const paymentStatus =
      paymentMethod === 'free' ? 'paid' : 'awaiting_payment';

    const row = {
      registration_id: registrationId,
      tournament_id: tournamentId,
      player_name: playerName,
      ea_id: eaId || null,
      gamertag,
      platform: platformNorm,
      discord_username: discordUsername || null,
      email: email || null,
      payment_reference: paymentReference,
      payment_amount: entryFee,
      payment_method: paymentMethod,
      payment_status: paymentStatus,
      user_id: authUserId || null,
    };

    const insertRes = await fetch(`${supabaseUrl}/rest/v1/registrations`, {
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
      console.error('Registration insert failed:', errText);
      // Surface unique violation cleanly
      if (insertRes.status === 409 || /duplicate|unique/i.test(errText)) {
        return res.status(409).json({
          error:
            'A registration with these details already exists. Contact admin if you need help.',
        });
      }
      return res.status(502).json({
        error: 'Could not create registration. Please try again.',
      });
    }

    const rows = await insertRes.json();
    const registration = Array.isArray(rows) ? rows[0] : rows;

    // Free entry: also write a payments row for consistency
    if (paymentMethod === 'free') {
      await fetch(`${supabaseUrl}/rest/v1/payments`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          registration_id: registration.id,
          provider: 'eft',
          provider_reference: paymentReference,
          amount: 0,
          currency: 'ZAR',
          status: 'verified',
          verified_at: new Date().toISOString(),
        }),
      }).catch((e) => console.error('Free payment row insert failed', e));

      await writeAudit(supabaseUrl, serviceKey, {
        registration_id: registration.id,
        action: 'registration_created_free',
        new_status: 'paid',
        note: 'Free tournament entry confirmed automatically',
        actor: 'system',
      });
    } else {
      await writeAudit(supabaseUrl, serviceKey, {
        registration_id: registration.id,
        action: 'registration_created',
        new_status: 'awaiting_payment',
        note: `Method: ${paymentMethod}`,
        actor: 'system',
      });
    }

    // Bank details for EFT (from env — never hardcode secrets)
    const bankDetails =
      paymentMethod === 'eft'
        ? {
            bank_name: process.env.NXT_BANK_NAME || null,
            account_name: process.env.NXT_BANK_ACCOUNT_NAME || null,
            account_number: process.env.NXT_BANK_ACCOUNT_NUMBER || null,
            branch_code: process.env.NXT_BANK_BRANCH_CODE || null,
            reference: paymentReference,
            amount: entryFee,
            currency: 'ZAR',
            instructions:
              'Use the payment reference exactly as shown so we can match your transfer.',
          }
        : null;

    return res.status(201).json({
      success: true,
      registration: {
        id: registration.id,
        registration_id: registration.registration_id,
        payment_reference: registration.payment_reference,
        payment_status: registration.payment_status,
        payment_method: registration.payment_method,
        payment_amount: Number(registration.payment_amount),
        tournament_id: registration.tournament_id,
        tournament_name: tournament.name,
        player_name: registration.player_name,
        gamertag: registration.gamertag,
        platform: registration.platform,
        ea_id: registration.ea_id,
        discord_username: registration.discord_username,
        email: registration.email,
        created_at: registration.created_at,
      },
      bank_details: bankDetails,
      message:
        paymentMethod === 'free'
          ? 'Registration confirmed. You are entered.'
          : paymentMethod === 'eft'
            ? 'Registration created. Complete EFT using the reference below, then upload proof.'
            : 'Registration created. Continue to secure card payment.',
    });
  } catch (err) {
    console.error('Registration create failed:', err);
    return res.status(500).json({
      error: 'Unable to create registration right now.',
    });
  }
};

function generateCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

async function writeAudit(supabaseUrl, serviceKey, entry) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/payment_audit_log`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(entry),
    });
  } catch (e) {
    console.error('Audit log write failed', e);
  }
}
