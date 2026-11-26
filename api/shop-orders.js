/**
 * POST /api/shop-orders
 * Create a merch order (EFT). Returns unique order number + bank details.
 *
 * Body: {
 *   name, email, phone, address, notes?,
 *   items: [{ id, name, price, qty }]
 * }
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *      NXT_BANK_NAME, NXT_BANK_ACCOUNT_NAME, NXT_BANK_ACCOUNT_NUMBER, NXT_BANK_BRANCH_CODE,
 *      RESEND_API_KEY (optional — order still created if email fails)
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Order service is not configured.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const clean = (v, max = 500) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';

  const name = clean(body.name, 120);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 40);
  const address = clean(body.address, 800);
  const notes = clean(body.notes, 1000);
  const itemsIn = Array.isArray(body.items) ? body.items : [];

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !emailOk || !phone || !address) {
    return res.status(400).json({
      error: 'Please fill in name, valid email, phone and delivery address.',
    });
  }
  if (!itemsIn.length) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }

  const items = itemsIn
    .map((i) => ({
      id: clean(String(i.id || ''), 80),
      name: clean(String(i.name || ''), 180),
      price: Math.max(0, Number(i.price) || 0),
      qty: Math.max(1, Math.min(99, Math.floor(Number(i.qty) || 1))),
    }))
    .filter((i) => i.name && i.price > 0);

  if (!items.length) {
    return res.status(400).json({ error: 'No valid items in cart.' });
  }

  const totalAmount = items.reduce((s, i) => s + i.price * i.qty, 0);
  if (totalAmount <= 0) {
    return res.status(400).json({ error: 'Order total must be greater than zero.' });
  }

  function generateCode(prefix) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${prefix}-${code}`;
  }

  try {
    // Unique order number (retry a few times on collision)
    let orderNumber = null;
    let order = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      orderNumber = generateCode('NXT-O');
      const insertRes = await fetch(`${supabaseUrl}/rest/v1/shop_orders`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          order_number: orderNumber,
          payment_reference: orderNumber,
          customer_name: name,
          email,
          phone,
          address,
          notes: notes || null,
          items,
          total_amount: totalAmount,
          currency: 'ZAR',
          payment_method: 'eft',
          payment_status: 'awaiting_payment',
        }),
      });

      if (insertRes.ok) {
        const rows = await insertRes.json();
        order = Array.isArray(rows) ? rows[0] : rows;
        break;
      }

      const errText = await insertRes.text();
      // unique violation → retry
      if (insertRes.status === 409 || /duplicate|unique/i.test(errText)) {
        continue;
      }
      console.error('shop_orders insert failed:', errText);
      return res.status(502).json({ error: 'Could not create order. Please try again.' });
    }

    if (!order) {
      return res.status(502).json({ error: 'Could not generate a unique order number.' });
    }

    const bankDetails = {
      bank_name: process.env.NXT_BANK_NAME || null,
      account_name: process.env.NXT_BANK_ACCOUNT_NAME || null,
      account_number: process.env.NXT_BANK_ACCOUNT_NUMBER || null,
      branch_code: process.env.NXT_BANK_BRANCH_CODE || null,
      reference: order.payment_reference,
      amount: Number(order.total_amount),
      currency: 'ZAR',
      instructions:
        'Use the order number exactly as the payment reference so we can match your transfer.',
    };

    // Notify team (best-effort)
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const itemLines = items
          .map((i) => `  ${i.qty}× ${i.name} — R ${(i.price * i.qty).toFixed(2)}`)
          .join('\n');
        const text = [
          'New NXT Supply order (EFT)',
          '',
          `Order number: ${order.order_number}`,
          `Status: awaiting_payment`,
          `Total: R ${Number(order.total_amount).toFixed(2)}`,
          '',
          `Customer: ${name}`,
          `Email: ${email}`,
          `Phone: ${phone}`,
          '',
          'Delivery address:',
          address,
          notes ? `\nNotes: ${notes}` : '',
          '',
          'Items:',
          itemLines,
          '',
          'Customer will pay via EFT using the order number as reference, then upload proof.',
        ].join('\n');

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'NXT Supply <onboarding@resend.dev>',
            to: ['info.nxtgg@gmail.com'],
            reply_to: email,
            subject: `NXT Supply order ${order.order_number} — R ${Number(order.total_amount).toFixed(2)}`,
            text,
          }),
        });
      } catch (mailErr) {
        console.error('Order notify email failed:', mailErr);
      }
    }

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        order_number: order.order_number,
        payment_reference: order.payment_reference,
        payment_status: order.payment_status,
        total_amount: Number(order.total_amount),
        currency: 'ZAR',
        customer_name: order.customer_name,
        email: order.email,
        items: order.items,
        created_at: order.created_at,
      },
      bank_details: bankDetails,
      message:
        'Order created. Pay via EFT using the order number as reference, then upload your proof of payment.',
    });
  } catch (err) {
    console.error('shop-orders create failed:', err);
    return res.status(500).json({ error: 'Unable to create order right now.' });
  }
};
