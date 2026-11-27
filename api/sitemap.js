/** GET /sitemap.xml  (rewritten here by vercel.json). Absolute URLs from the request host. */
const { rest, config } = require('./_lib/supabase');

const STATIC = ['index.html', 'tournaments.html', 'discover.html', 'leaderboards.html', 'communities.html',
  'teams.html', 'games.html', 'creators.html', 'community.html', 'about.html', 'shop.html', 'sponsors.html',
  'contact.html', 'creator-apply.html', 'privacy.html', 'terms.html'];

const x = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

module.exports = async function handler(req, res) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').replace(/[^a-z0-9.:-]/gi, '');
  const base = `https://${host}`;
  const urls = STATIC.map((p) => `${base}/${p}`);

  if (config().ok) {
    const grab = async (path, fn) => {
      try { const r = await rest(path); if (r.ok && Array.isArray(r.data)) r.data.forEach((row) => urls.push(`${base}/${fn(row)}`)); } catch { /* skip */ }
    };
    await Promise.all([
      grab('games?is_active=eq.true&select=slug&limit=500', (r) => `games.html?slug=${encodeURIComponent(r.slug)}`),
      grab('communities?status=eq.active&select=slug&limit=2000', (r) => `communities.html?slug=${encodeURIComponent(r.slug)}`),
      grab('teams?select=slug&limit=2000', (r) => `teams.html?slug=${encodeURIComponent(r.slug)}`),
      grab("tournaments?status=in.(open,live,closed,completed)&approval_status=eq.approved&visibility=eq.public&select=id&limit=2000", (r) => `tournament.html?id=${Number(r.id)}`),
      grab('profiles?account_status=eq.active&username=not.is.null&select=id&order=created_at.desc&limit=2000', (r) => `profile.html?id=${encodeURIComponent(r.id)}`),
    ]);
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${x(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
};
