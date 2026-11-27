/** GET /robots.txt (rewritten here by vercel.json). */
module.exports = function handler(req, res) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-z0-9.:-]/gi, '');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=86400');
  res.status(200).send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /messages',
    'Disallow: /notifications',
    'Disallow: /settings',
    'Disallow: /challenges',
    'Disallow: /checkout',
    'Disallow: /player-dashboard',
    'Disallow: /creator-dashboard',
    '',
    `Sitemap: https://${host}/sitemap.xml`,
    '',
  ].join('\n'));
};
