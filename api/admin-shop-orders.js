/**
 * POST /api/admin-shop-orders
 * Admin list / approve / reject shop orders.
 *
 * Body: {
 *   admin_key: string,
 *   action: 'list' | 'approve' | 'reject',
 *   payment_status?: string,   // list filter
 *   order_number?: string,     // for approve/reject
 *   note?: string
 * }
 *
 * Env: NXT_ADMIN_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (optional)
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminKey = process.env.NXT_ADMIN_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!adminKey || !supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Admin service is not configured.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const provided = typeof body.admin_key === 'string' ? body.admin_key.trim() : '';
  if (!provided || provided !== adminKey) {
    return res.status(401).json({ error: 'Invalid admin key.' });
  }

  const action = typeof body.action === 'string' ? body.action.trim() : 'list';

  try {
    if (action === 'list') {
      const status =
        typeof body.payment_status === 'string' ? body.payment_status.trim() : '';
      const limit = Math.min(200, Math.max(1, Number(body.limit) || 50));

      let query = `shop_orders?select=*&order=created_at.desc&limit=${limit}`;
      if (status) query += `&payment_status=eq.${encodeURIComponent(status)}`;

      const listRes = await fetch(`${supabaseUrl}/rest/v1/${query}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });

      if (!listRes.ok) {
        console.error('shop list failed', await listRes.text());
        return res.status(502).json({ error: 'Could not load shop orders.' });
      }

      const orders = await listRes.json();
      const paidRes = await fetch(
        `${supabaseUrl}/rest/v1/shop_orders?payment_status=eq.paid&select=total_amount`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const paidRows = paidRes.ok ? await paidRes.json() : [];
      const revenue = (Array.isArray(paidRows) ? paidRows : []).reduce(
        (s, r) => s + (Number(r.total_amount) || 0),
        0
      );

      return res.status(200).json({
        success: true,
        orders: Array.isArray(orders) ? orders : [],
        revenue,
      });
    }

    if (action === 'approve' || action === 'reject') {
      const orderNumber =
        typeof body.order_number === 'string'
          ? body.order_number.trim().toUpperCase()
          : '';
      const note =
        typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

      if (!orderNumber) {
        return res.status(400).json({ error: 'order_number is required.' });
      }

      const findRes = await fetch(
        `${supabaseUrl}/rest/v1/shop_orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=*`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      if (!findRes.ok) {
        return res.status(502).json({ error: 'Could not look up order.' });
      }
      const rows = await findRes.json();
      const order = Array.isArray(rows) ? rows[0] : null;
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      if (action === 'approve') {
        if (order.payment_status === 'paid') {
          return res.status(200).json({
            success: true,
            message: 'Order is already marked paid.',
            order,
          });
        }
        if (order.payment_status === 'cancelled') {
          return res.status(400).json({ error: 'Cannot approve a cancelled order.' });
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
              payment_status: 'paid',
              reviewed_at: new Date().toISOString(),
              reviewed_by: 'admin',
              admin_note: note || order.admin_note || null,
            }),
          }
        );
        if (!patchRes.ok) {
          console.error('approve failed', await patchRes.text());
          return res.status(502).json({ error: 'Could not approve order.' });
        }
        const updated = await patchRes.json();
        const out = Array.isArray(updated) ? updated[0] : updated;

        await notifyCustomer(order, 'approved', note);

        return res.status(200).json({
          success: true,
          message: 'Order marked paid.',
          order: out,
        });
      }

      // reject
      if (['paid', 'cancelled'].includes(order.payment_status)) {
        return res.status(400).json({
          error: `Cannot reject an order that is ${order.payment_status}.`,
        });
      }

      const rejectRes = await fetch(
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
            payment_status: 'payment_rejected',
            reviewed_at: new Date().toISOString(),
            reviewed_by: 'admin',
            admin_note: note || 'Payment rejected',
          }),
        }
      );
      if (!rejectRes.ok) {
        console.error('reject failed', await rejectRes.text());
        return res.status(502).json({ error: 'Could not reject order.' });
      }
      const updated = await rejectRes.json();
      const out = Array.isArray(updated) ? updated[0] : updated;

      await notifyCustomer(order, 'rejected', note);

      return res.status(200).json({
        success: true,
        message: 'Order payment rejected.',
        order: out,
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin-shop-orders error:', err);
    return res.status(500).json({ error: 'Admin request failed.' });
  }
};

async function notifyCustomer(order, outcome, note) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey || !order?.email) return;
  try {
    const subject =
      outcome === 'approved'
        ? `Payment confirmed — ${order.order_number}`
        : `Payment update — ${order.order_number}`;
    const text =
      outcome === 'approved'
        ? [
            `Hi ${order.customer_name},`,
            '',
            `We've confirmed your payment for order ${order.order_number}.`,
            `Total: R ${Number(order.total_amount).toFixed(2)}`,
            '',
            'We will prepare your order for delivery/collection.',
            note ? `Note: ${note}` : '',
            '',
            '— NXT Supply',
          ]
            .filter(Boolean)
            .join('\n')
        : [
            `Hi ${order.customer_name},`,
            '',
            `We could not verify the payment for order ${order.order_number}.`,
            note ? `Reason: ${note}` : 'Please contact us or re-upload a clear proof with the correct reference.',
            '',
            '— NXT Supply',
          ].join('\n');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'NXT Supply <onboarding@resend.dev>',
        to: [order.email],
        bcc: ['info.nxtgg@gmail.com'],
        subject,
        text,
      }),
    });
  } catch (e) {
    console.error('customer notify failed:', e);
  }
}
