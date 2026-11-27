/**
 * POST /api/admin-payments
 * Admin actions on registrations / EFT proofs.
 *
 * Body: {
 *   action: 'list' | 'approve' | 'reject' | 'note',
 *   admin_key: string,                 // must match NXT_ADMIN_KEY env
 *   registration_id?: string,          // public NXT-R-… or uuid
 *   note?: string,
 *   tournament_id?: number,            // for list filter
 *   payment_status?: string,           // for list filter
 *   limit?: number
 * }
 *
 * Security: simple shared admin key for Stage 1.
 * Replace later with Supabase Auth + role claim when ready.
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NXT_ADMIN_KEY
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminKey = process.env.NXT_ADMIN_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Service not configured.' });
  }
  if (!adminKey) {
    return res.status(500).json({
      error: 'Admin access is not configured. Set NXT_ADMIN_KEY on Vercel.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const providedKey = String(body.admin_key || '').trim();
  if (!providedKey || providedKey !== adminKey) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const action = String(body.action || '').toLowerCase();
  const clean = (v, max = 500) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  try {
    if (action === 'list') {
      return await listRegistrations(req, res, supabaseUrl, serviceKey, body);
    }
    if (action === 'approve' || action === 'reject' || action === 'note') {
      return await mutateRegistration(req, res, supabaseUrl, serviceKey, body, action);
    }
    return res.status(400).json({
      error: 'Unknown action. Use list, approve, reject, or note.',
    });
  } catch (err) {
    console.error('admin-payments error:', err);
    return res.status(500).json({ error: 'Admin request failed.' });
  }
};

async function listRegistrations(req, res, supabaseUrl, serviceKey, body) {
  const tournamentId = Number(body.tournament_id) || null;
  const status = typeof body.payment_status === 'string' ? body.payment_status.trim() : '';
  const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);

  let query = `registrations?select=*,tournaments(name,entry_fee)&order=created_at.desc&limit=${limit}`;
  if (tournamentId) query += `&tournament_id=eq.${tournamentId}`;
  if (status) query += `&payment_status=eq.${encodeURIComponent(status)}`;

  const r = await fetch(`${supabaseUrl}/rest/v1/${query}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });

  if (!r.ok) {
    console.error(await r.text());
    return res.status(502).json({ error: 'Could not load registrations.' });
  }

  const rows = await r.json();

  // Revenue summary (paid only)
  let revenueQuery = `registrations?payment_status=eq.paid&select=payment_amount`;
  if (tournamentId) revenueQuery += `&tournament_id=eq.${tournamentId}`;
  const revRes = await fetch(`${supabaseUrl}/rest/v1/${revenueQuery}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  let totalRevenue = 0;
  if (revRes.ok) {
    const paid = await revRes.json();
    totalRevenue = (Array.isArray(paid) ? paid : []).reduce(
      (s, row) => s + (Number(row.payment_amount) || 0),
      0
    );
  }

  return res.status(200).json({
    success: true,
    registrations: rows,
    total_confirmed_revenue: totalRevenue,
    currency: 'ZAR',
  });
}

async function mutateRegistration(req, res, supabaseUrl, serviceKey, body, action) {
  const key = String(body.registration_id || '').trim();
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '';

  if (!key) {
    return res.status(400).json({ error: 'registration_id is required.' });
  }

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  const filter = isUuid
    ? `id=eq.${key}`
    : `registration_id=eq.${encodeURIComponent(key)}`;

  const regRes = await fetch(
    `${supabaseUrl}/rest/v1/registrations?${filter}&select=*`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  if (!regRes.ok) {
    return res.status(502).json({ error: 'Could not load registration.' });
  }
  const regs = await regRes.json();
  const registration = Array.isArray(regs) ? regs[0] : null;
  if (!registration) {
    return res.status(404).json({ error: 'Registration not found.' });
  }

  const oldStatus = registration.payment_status;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  if (action === 'note') {
    if (!note) {
      return res.status(400).json({ error: 'Note text is required.' });
    }
    const existing = registration.admin_notes
      ? `${registration.admin_notes}\n---\n${note}`
      : note;
    await fetch(`${supabaseUrl}/rest/v1/registrations?id=eq.${registration.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ admin_notes: existing }),
    });
    await writeAudit(supabaseUrl, serviceKey, {
      registration_id: registration.id,
      action: 'admin_note',
      note,
      actor: 'admin',
    });
    return res.status(200).json({ success: true, message: 'Note saved.' });
  }

  if (action === 'approve') {
    if (registration.payment_status === 'paid') {
      return res.status(200).json({
        success: true,
        message: 'Already paid.',
        registration,
      });
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/registrations?id=eq.${registration.id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          payment_status: 'paid',
          admin_notes: note
            ? registration.admin_notes
              ? `${registration.admin_notes}\n---\n${note}`
              : note
            : registration.admin_notes,
        }),
      }
    );
    if (!patchRes.ok) {
      console.error(await patchRes.text());
      return res.status(502).json({ error: 'Could not approve payment.' });
    }
    const patched = await patchRes.json();
    const updated = Array.isArray(patched) ? patched[0] : patched;

    // Mark related EFT payment + proofs
    await fetch(
      `${supabaseUrl}/rest/v1/payments?registration_id=eq.${registration.id}&provider=eq.eft`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'verified',
          verified_at: new Date().toISOString(),
        }),
      }
    );
    await fetch(
      `${supabaseUrl}/rest/v1/payment_proofs?registration_id=eq.${registration.id}&verification_status=eq.pending`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          verification_status: 'accepted',
          reviewed_at: new Date().toISOString(),
          reviewed_by: 'admin',
        }),
      }
    );

    await writeAudit(supabaseUrl, serviceKey, {
      registration_id: registration.id,
      action: 'payment_approved',
      old_status: oldStatus,
      new_status: 'paid',
      note: note || 'Admin approved',
      actor: 'admin',
    });

    return res.status(200).json({
      success: true,
      message: 'Payment approved. Registration is paid.',
      registration: updated,
    });
  }

  // reject
  if (['paid', 'cancelled', 'refunded'].includes(registration.payment_status)) {
    return res.status(400).json({
      error: `Cannot reject a registration that is ${registration.payment_status}.`,
    });
  }

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/registrations?id=eq.${registration.id}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        payment_status: 'payment_rejected',
        admin_notes: note
          ? registration.admin_notes
            ? `${registration.admin_notes}\n---\n${note}`
            : note
          : registration.admin_notes,
      }),
    }
  );
  if (!patchRes.ok) {
    console.error(await patchRes.text());
    return res.status(502).json({ error: 'Could not reject payment.' });
  }
  const patched = await patchRes.json();
  const updated = Array.isArray(patched) ? patched[0] : patched;

  await fetch(
    `${supabaseUrl}/rest/v1/payments?registration_id=eq.${registration.id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'failed' }),
    }
  );
  await fetch(
    `${supabaseUrl}/rest/v1/payment_proofs?registration_id=eq.${registration.id}&verification_status=eq.pending`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        verification_status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: 'admin',
      }),
    }
  );

  await writeAudit(supabaseUrl, serviceKey, {
    registration_id: registration.id,
    action: 'payment_rejected',
    old_status: oldStatus,
    new_status: 'payment_rejected',
    note: note || 'Admin rejected',
    actor: 'admin',
  });

  return res.status(200).json({
    success: true,
    message: 'Payment rejected.',
    registration: updated,
  });
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
