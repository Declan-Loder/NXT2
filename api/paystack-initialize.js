/**
 * POST /api/paystack-initialize
 * Body: {
 *   type: 'tournament' | 'shop',
 *   email: string,
 *   amount: number,          // ZAR (rands), e.g. 50.00
 *   metadata?: object,
 *   callback_url?: string
 * }
 * Requires env: PAYSTACK_SECRET_KEY
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
  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  const type = String(body.type || 'tournament');
  const amountZar = Number(body.amount);
  const metadata =
    body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  const callbackUrl = String(body.callback_url || '').trim();

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailOk) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!Number.isFinite(amountZar) || amountZar < 1) {
    return res.status(400).json({
      error: 'Amount must be at least R 1.00.',
    });
  }

  // Paystack expects amount in the lowest currency unit (cents for ZAR)
  const amountCents = Math.round(amountZar * 100);

  const payload = {
    email,
    amount: amountCents,
    currency: 'ZAR',
    metadata: {
      ...metadata,
      nxt_type: type,
    },
  };

  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }

  try {
    const response = await fetch(
      'https://api.paystack.co/transaction/initialize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.status) {
      console.error('Paystack initialize error:', result);
      return res.status(502).json({
        error:
          result.message ||
          'Paystack could not start this payment. Try again.',
      });
    }

    return res.status(200).json({
      success: true,
      authorization_url: result.data.authorization_url,
      access_code: result.data.access_code,
      reference: result.data.reference,
    });
  } catch (err) {
    console.error('Paystack initialize failed:', err);
    return res.status(500).json({
      error: 'Unable to start payment right now.',
    });
  }
};
