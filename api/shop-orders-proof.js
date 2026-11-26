/**
 * POST /api/shop-orders-proof
 * Upload EFT proof for a shop order.
 *
 * Body: {
 *   order_number: string,          // NXT-O-XXXX
 *   email?: string,
 *   file_name: string,
 *   content_type: string,
 *   file_base64: string
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
    return res.status(500).json({ error: 'Payment service is not configured.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const clean = (v, max = 200) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  const orderNumber = clean(body.order_number, 40).toUpperCase();
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

  if (!orderNumber) {
    return res.status(400).json({ error: 'Order number is required.' });
  }
  if (!fileBase64) {
    return res.status(400).json({ error: 'Proof of payment file is required.' });
  }
  if (!allowedTypes.includes(contentType)) {
    return res.status(400).json({
      error: 'Proof must be a JPEG, PNG, WebP image or PDF.',
    });
  }

  const approxBytes = Math.ceil((fileBase64.length * 3) / 4);
  if (approxBytes > 5 * 1024 * 1024) {
    return res.status(400).json({ error: 'Proof file must be 5 MB or smaller.' });
  }

  try {
    const orderRes = await fetch(
      `${supabaseUrl}/rest/v1/shop_orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=*`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      }
    );

    if (!orderRes.ok) {
      console.error('Order fetch failed', await orderRes.text());
      return res.status(502).json({ error: 'Could not look up order.' });
    }

    const orders = await orderRes.json();
    const order = Array.isArray(orders) ? orders[0] : null;

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (email && order.email && order.email !== email) {
      return res.status(400).json({ error: 'Email does not match this order.' });
    }
    if (['paid', 'cancelled'].includes(order.payment_status)) {
      return res.status(400).json({
        error: `Order is already ${order.payment_status}.`,
      });
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const storagePath = `shop/${order.id}/${Date.now()}-${safeName}`;

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
      console.error('Storage upload failed:', await uploadRes.text());
      return res.status(502).json({
        error: 'Could not store proof of payment. Please try again.',
      });
    }

    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/shop_orders?id=eq.${order.id}`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          payment_status: 'pending_verification',
          proof_storage_path: storagePath,
          proof_file_name: safeName,
          proof_content_type: contentType,
          proof_uploaded_at: new Date().toISOString(),
        }),
      }
    );

    if (!patchRes.ok) {
      console.error('Order status update failed:', await patchRes.text());
      return res.status(502).json({
        error: 'Proof uploaded but order status could not be updated. Contact support with your order number.',
      });
    }

    // Notify team
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'NXT Supply <onboarding@resend.dev>',
            to: ['info.nxtgg@gmail.com'],
            reply_to: order.email,
            subject: `Proof uploaded — ${order.order_number} (pending review)`,
            text: [
              'EFT proof uploaded for a shop order.',
              '',
              `Order: ${order.order_number}`,
              `Customer: ${order.customer_name} <${order.email}>`,
              `Phone: ${order.phone}`,
              `Amount: R ${Number(order.total_amount).toFixed(2)}`,
              `File: ${safeName}`,
              '',
              'Review in Admin → Shop orders and mark Paid once funds clear.',
            ].join('\n'),
          }),
        });
      } catch (mailErr) {
        console.error('Proof notify email failed:', mailErr);
      }
    }

    return res.status(200).json({
      success: true,
      order_number: order.order_number,
      payment_status: 'pending_verification',
      message:
        'Proof received. Your order is pending verification. We will confirm once payment is reviewed.',
    });
  } catch (err) {
    console.error('shop-orders-proof failed:', err);
    return res.status(500).json({
      error: 'Unable to process proof of payment right now.',
    });
  }
};
