/**
 * POST /api/payments-eft
 * Submit EFT proof of payment for an existing registration.
 *
 * Body (JSON): {
 *   registration_id: string,     // public NXT-R-XXXX or internal uuid
 *   payment_reference: string,   // NXT-P-XXXX (required for verification)
 *   email?: string,              // optional extra check
 *   file_name: string,
 *   content_type: string,        // image/jpeg | image/png | image/webp | application/pdf
 *   file_base64: string          // base64 without data-URL prefix
 * }
 *
 * Flow:
 *  1. Locate registration by public id + payment_reference
 *  2. Ensure method is eft and status allows proof
 *  3. Upload file to Supabase Storage bucket payment-proofs
 *  4. Insert payment_proofs row
 *  5. Upsert payments row (provider=eft)
 *  6. Set registration payment_status = pending_verification
 *  7. Audit log
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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
      error: 'Payment service is not configured.',
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const clean = (v, max = 200) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  const registrationKey = clean(body.registration_id, 80);
  const paymentReference = clean(body.payment_reference, 80);
  const email = clean(body.email, 254).toLowerCase();
  const fileName = clean(body.file_name, 180) || 'proof.jpg';
  const contentType = clean(body.content_type, 80).toLowerCase();
  const fileBase64 = typeof body.file_base64 === 'string' ? body.file_base64 : '';

  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  if (!registrationKey || !paymentReference) {
    return res.status(400).json({
      error: 'Registration ID and payment reference are required.',
    });
  }
  if (!fileBase64) {
    return res.status(400).json({ error: 'Proof of payment file is required.' });
  }
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({
      error: 'Proof must be a JPEG, PNG, WebP image or PDF.',
    });
  }

  // Size guard (~5 MB decoded)
  const approxBytes = Math.ceil((fileBase64.length * 3) / 4);
  if (approxBytes > 5 * 1024 * 1024) {
    return res.status(400).json({
      error: 'Proof file must be 5 MB or smaller.',
    });
  }

  try {
    // Resolve registration — accept either registration_id (NXT-R-…) or uuid
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        registrationKey
      );
    const filter = isUuid
      ? `id=eq.${registrationKey}`
      : `registration_id=eq.${encodeURIComponent(registrationKey)}`;

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
      console.error('Reg fetch failed', await regRes.text());
      return res.status(502).json({ error: 'Could not look up registration.' });
    }

    const regs = await regRes.json();
    const registration = Array.isArray(regs) ? regs[0] : null;

    if (!registration) {
      return res.status(404).json({ error: 'Registration not found.' });
    }
    if (registration.payment_reference !== paymentReference) {
      return res.status(400).json({
        error: 'Payment reference does not match this registration.',
      });
    }
    if (registration.payment_method !== 'eft') {
      return res.status(400).json({
        error: 'This registration is not set up for EFT payment.',
      });
    }
    if (['paid', 'cancelled', 'refunded'].includes(registration.payment_status)) {
      return res.status(400).json({
        error: `Registration is already ${registration.payment_status}.`,
      });
    }
    if (email && registration.email && registration.email !== email) {
      return res.status(400).json({
        error: 'Email does not match this registration.',
      });
    }

    // Decode and upload to Storage
    const buffer = Buffer.from(fileBase64, 'base64');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const storagePath = `${registration.id}/${Date.now()}-${safeName}`;

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/payment-proofs/${storagePath}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': contentType,
          'x-upsert': 'false',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('Storage upload failed:', errText);
      return res.status(502).json({
        error: 'Could not store proof of payment. Please try again.',
      });
    }

    // payment_proofs row
    const proofRes = await fetch(`${supabaseUrl}/rest/v1/payment_proofs`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        registration_id: registration.id,
        storage_path: storagePath,
        file_name: safeName,
        content_type: contentType,
        file_size_bytes: buffer.length,
        verification_status: 'pending',
      }),
    });

    if (!proofRes.ok) {
      console.error('Proof row insert failed:', await proofRes.text());
      return res.status(502).json({
        error: 'Proof uploaded but could not be recorded. Contact support with your reference.',
      });
    }

    const proofRows = await proofRes.json();
    const proof = Array.isArray(proofRows) ? proofRows[0] : proofRows;

    // payments row (insert or update pending)
    const existingPayRes = await fetch(
      `${supabaseUrl}/rest/v1/payments?registration_id=eq.${registration.id}&provider=eq.eft&select=id&limit=1`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );
    const existingPays = await existingPayRes.json();
    const existingPay = Array.isArray(existingPays) ? existingPays[0] : null;

    if (existingPay) {
      await fetch(
        `${supabaseUrl}/rest/v1/payments?id=eq.${existingPay.id}`,
        {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 'submitted',
            provider_reference: paymentReference,
            amount: Number(registration.payment_amount),
            updated_at: new Date().toISOString(),
          }),
        }
      );
    } else {
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
          amount: Number(registration.payment_amount),
          currency: 'ZAR',
          status: 'submitted',
        }),
      });
    }

    // Update registration status
    const oldStatus = registration.payment_status;
    await fetch(
      `${supabaseUrl}/rest/v1/registrations?id=eq.${registration.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payment_status: 'pending_verification',
        }),
      }
    );

    await fetch(`${supabaseUrl}/rest/v1/payment_audit_log`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        registration_id: registration.id,
        action: 'eft_proof_submitted',
        old_status: oldStatus,
        new_status: 'pending_verification',
        note: `Proof uploaded: ${safeName}`,
        actor: email || registration.email || 'player',
      }),
    });

    return res.status(200).json({
      success: true,
      registration_id: registration.registration_id,
      payment_reference: registration.payment_reference,
      payment_status: 'pending_verification',
      proof_id: proof.id,
      message:
        'Proof received. Your payment is pending verification. You will be confirmed once an admin approves it.',
    });
  } catch (err) {
    console.error('EFT submit failed:', err);
    return res.status(500).json({
      error: 'Unable to process proof of payment right now.',
    });
  }
};
