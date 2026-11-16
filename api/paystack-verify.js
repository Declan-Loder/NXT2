/**
 * POST /api/paystack-verify
 * Body: { reference: string }
 *
 * Verifies a Paystack transaction server-side.
 * For tournament payments:
 *  - Prefers updating an existing registration (created via /api/registrations)
 *    identified by metadata.nxt_registration_id or metadata.payment_reference
 *  - Records a payments row + audit entry
 *  - Marks registration paid only after Paystack confirms success
 *  - Falls back to legacy insert if no pre-created registration exists
 *
 * Requires: PAYSTACK_SECRET_KEY
 * Optional: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    return res.status(500).json({
      error: 'Paystack is not configured. Add PAYSTACK_SECRET_KEY on Vercel.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const reference = String(body.reference || '').trim();
  if (!reference) {
    return res.status(400).json({ error: 'Payment reference is required.' });
  }

  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secret}`,
        },
      }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
      console.error('Paystack verify error:', result);
      return res.status(502).json({
        error: result.message || 'Could not verify this payment.',
      });
    }

    const data = result.data || {};
    const paid = data.status === 'success';
    const meta = data.metadata || {};
    const amountZar = (Number(data.amount) || 0) / 100;

    let registration = null;

    if (
      paid &&
      meta.nxt_type === 'tournament' &&
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
    ) {
      registration = await confirmTournamentPayment({
        supabaseUrl: process.env.SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        reference,
        amountZar,
        meta,
        customerEmail: data.customer?.email || meta.email || null,
        rawPayload: {
          status: data.status,
          amount: data.amount,
          currency: data.currency,
          paid_at: data.paid_at,
          channel: data.channel,
        },
      });
    }

    return res.status(200).json({
      success: true,
      paid,
      status: data.status,
      reference: data.reference,
      amount: amountZar,
      currency: data.currency || 'ZAR',
      email: data.customer?.email || null,
      metadata: meta,
      registration,
      message: paid
        ? 'Payment verified successfully.'
        : `Payment status: ${data.status}`,
    });
  } catch (err) {
    console.error('Paystack verify failed:', err);
    return res.status(500).json({
      error: 'Unable to verify payment right now.',
    });
  }
};

async function confirmTournamentPayment({
  supabaseUrl,
  serviceKey,
  reference,
  amountZar,
  meta,
  customerEmail,
  rawPayload,
}) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // 1) Prefer pre-created registration
  let registration = null;
  const publicRegId = String(meta.nxt_registration_id || meta.registration_id || '').trim();
  const paymentRef = String(meta.payment_reference || '').trim();

  if (publicRegId) {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/registrations?registration_id=eq.${encodeURIComponent(publicRegId)}&select=*`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      registration = Array.isArray(rows) ? rows[0] : null;
    }
  }

  if (!registration && paymentRef) {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/registrations?payment_reference=eq.${encodeURIComponent(paymentRef)}&select=*`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      registration = Array.isArray(rows) ? rows[0] : null;
    }
  }

  // Idempotency: already paid for this provider reference
  if (registration && registration.payment_status === 'paid') {
    return registration;
  }

  if (registration) {
    const oldStatus = registration.payment_status;

    // Update registration → paid
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/registrations?id=eq.${registration.id}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          payment_status: 'paid',
          payment_method: 'card',
        }),
      }
    );

    if (patchRes.ok) {
      const patched = await patchRes.json();
      registration = Array.isArray(patched) ? patched[0] : registration;
    }

    await upsertCardPayment(supabaseUrl, serviceKey, {
      registrationId: registration.id,
      providerReference: reference,
      amount: amountZar,
      rawPayload,
    });

    await writeAudit(supabaseUrl, serviceKey, {
      registration_id: registration.id,
      action: 'card_payment_verified',
      old_status: oldStatus,
      new_status: 'paid',
      note: `Paystack reference ${reference}`,
      actor: 'paystack-verify',
    });

    return registration;
  }

  // 2) Legacy path: no pre-created registration — insert one (older clients)
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/registrations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      registration_id: generateCode('NXT-R'),
      tournament_id: Number(meta.tournament_id) || null,
      player_name: String(meta.player_name || '').slice(0, 120) || 'Player',
      ea_id: String(meta.ea_id || '').slice(0, 80) || null,
      gamertag: String(meta.gamertag || '').slice(0, 80) || 'Unknown',
      platform: String(meta.platform || 'PC').slice(0, 40),
      discord_username: String(meta.discord_username || '').slice(0, 80) || null,
      email: String(customerEmail || meta.email || '').slice(0, 254) || null,
      payment_reference: String(meta.payment_reference || reference).slice(0, 80),
      payment_amount: amountZar,
      payment_method: 'card',
      payment_status: 'paid',
    }),
  });

  if (insertRes.ok) {
    const rows = await insertRes.json();
    registration = Array.isArray(rows) ? rows[0] : rows;

    await upsertCardPayment(supabaseUrl, serviceKey, {
      registrationId: registration.id,
      providerReference: reference,
      amount: amountZar,
      rawPayload,
    });

    await writeAudit(supabaseUrl, serviceKey, {
      registration_id: registration.id,
      action: 'card_payment_verified_legacy_insert',
      new_status: 'paid',
      note: `Paystack reference ${reference}`,
      actor: 'paystack-verify',
    });
  } else {
    const errText = await insertRes.text();
    console.error('Supabase registration insert failed:', errText);
  }

  return registration;
}

async function upsertCardPayment(supabaseUrl, serviceKey, { registrationId, providerReference, amount, rawPayload }) {
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // Idempotent: if this provider reference already exists, skip
  const existing = await fetch(
    `${supabaseUrl}/rest/v1/payments?provider=eq.paystack&provider_reference=eq.${encodeURIComponent(providerReference)}&select=id&limit=1`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (existing.ok) {
    const rows = await existing.json();
    if (Array.isArray(rows) && rows.length > 0) return;
  }

  await fetch(`${supabaseUrl}/rest/v1/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      registration_id: registrationId,
      provider: 'paystack',
      provider_reference: providerReference,
      amount,
      currency: 'ZAR',
      status: 'verified',
      verified_at: new Date().toISOString(),
      raw_provider_payload: rawPayload || null,
    }),
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

function generateCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}
