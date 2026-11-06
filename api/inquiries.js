module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.error('RESEND_API_KEY is not configured.');

    return res.status(500).json({
      error: 'Email service is not configured yet.'
    });
  }

  const body =
    req.body && typeof req.body === 'object' ? req.body : {};

  const formType = body.formType;
  const data =
    body.data && typeof body.data === 'object' ? body.data : {};

  // Ignore submissions caught by the hidden anti-spam field.
  if (String(data['bot-field'] || '').trim()) {
    return res.status(200).json({ success: true });
  }

  const clean = (value, max = 2000) =>
    typeof value === 'string'
      ? value.trim().slice(0, max)
      : '';

  let subject;
  let text;
  let replyTo;

  // COLLABORATION FORM
  if (formType === 'collab') {
    const name = clean(data.name, 120);
    const type = clean(data.type, 80);
    const title = clean(data.title, 180);
    const details = clean(data.details, 5000);

    if (
      !name ||
      !['Looking for', 'Offering'].includes(type) ||
      !title ||
      !details
    ) {
      return res.status(400).json({
        error: 'Please complete all collaboration form fields.'
      });
    }

    subject = `NXT Elite collaboration request: ${title}`;

    text = [
      'New collaboration request from the NXT Elite website',
      '',
      `Name / Discord: ${name}`,
      `Type: ${type}`,
      `Title: ${title}`,
      '',
      'Details:',
      details
    ].join('\n');

  // SPONSORSHIP FORM
  } else if (formType === 'sponsor') {
    const name = clean(data.name, 120);
    const brand = clean(data.brand, 180);
    const email = clean(data.email, 254);
    const interest = clean(data.interest, 120);
    const message = clean(data.message, 5000);

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (
      !name ||
      !brand ||
      !emailPattern.test(email) ||
      !interest ||
      !message
    ) {
      return res.status(400).json({
        error: 'Please complete all sponsorship fields with a valid email.'
      });
    }

    subject = `NXT Elite sponsorship enquiry: ${brand}`;
    replyTo = email;

    text = [
      'New sponsorship / partnership enquiry from the NXT Elite website',
      '',
      `Contact name: ${name}`,
      `Company / brand: ${brand}`,
      `Contact email: ${email}`,
      `Interest: ${interest}`,
      '',
      'Message:',
      message
    ].join('\n');

  } else {
    return res.status(400).json({
      error: 'Unknown enquiry form.'
    });
  }

  try {
    const emailPayload = {
      from: 'NXT Elite <onboarding@resend.dev>',
      to: ['info.nxtgg@gmail.com'],
      subject,
      text
    };

    if (replyTo) {
      emailPayload.reply_to = replyTo;
    }

    const emailResponse = await fetch(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailPayload)
      }
    );

    const result = await emailResponse.json().catch(() => ({}));

    if (!emailResponse.ok) {
      console.error('Resend API error:', result);

      return res.status(502).json({
        error:
          result.message ||
          'The email service rejected this enquiry.'
      });
    }

    return res.status(200).json({
      success: true,
      id: result.id
    });

  } catch (error) {
    console.error('Inquiry email function failed:', error);

    return res.status(500).json({
      error: 'Unable to send your enquiry right now.'
    });
  }
};
