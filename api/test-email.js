
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const testSecret = process.env.TEST_EMAIL_SECRET;

  if (!apiKey || !testSecret) {
    return res.status(500).json({
      error: 'Missing RESEND_API_KEY or TEST_EMAIL_SECRET in Vercel.'
    });
  }

  if (req.headers['x-test-secret'] !== testSecret) {
    return res.status(401).json({
      error: 'Incorrect test secret.'
    });
  }

  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'NXT Elite <onboarding@resend.dev>',
        to: ['info.nxtgg@gmail.com'],
        subject: 'NXT Elite - Email Test',
        text: 'Success! Your NXT Elite website has connected to Resend.'
      })
    });

    const result = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error('Resend API error:', result);

      return res.status(502).json({
        error: result.message || 'Resend rejected the email.',
        details: result.name || null
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Resend accepted the email.',
      id: result.id
    });
  } catch (error) {
    console.error('Email function error:', error);

    return res.status(500).json({
      error: 'The email function failed.',
      details: error.message
    });
  }
};
