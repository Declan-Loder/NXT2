/**
 * POST /api/creator-applications
 * actions: apply | list | review
 *
 * apply: public (optional auth)
 * list / review: requires a Bearer token of an active admin/superadmin
 */
const { requireRole, ADMIN_ROLES, limitIp, rest, audit } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Service not configured.' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || 'apply').toLowerCase();
  const clean = (v, max = 2000) =>
    typeof v === 'string' ? v.trim().slice(0, max) : '';
  // Accept only https URLs (bare "twitch.tv/x" is upgraded); anything else -> null.
  const httpsUrl = (v) => {
    let t = clean(v, 300);
    if (!t) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = 'https://' + t;
    return /^https:\/\/[^\s]{1,290}$/i.test(t) ? t : null;
  };

  // Optional auth user
  let authUserId = null;
  const authHeader = String(req.headers.authorization || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    try {
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${authHeader.slice(7).trim()}`,
        },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        if (u?.id) authUserId = u.id;
      }
    } catch {}
  }

  try {
    if (action === 'apply') {
      if (!(await limitIp(req, res, 'creator-apply', 5, 3600))) return;
      const email = clean(body.email, 254).toLowerCase();
      const displayName = clean(body.display_name, 120);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email is required.' });
      }
      if (!displayName) {
        return res.status(400).json({ error: 'Display name is required.' });
      }

      const row = {
        user_id: authUserId,
        email,
        display_name: displayName,
        country: clean(body.country, 80) || 'ZA',
        bio: clean(body.bio, 4000) || null,
        category: clean(body.category, 120) || null,
        interests: clean(body.interests, 500) || null,
        twitch_url: httpsUrl(body.twitch_url),
        youtube_url: httpsUrl(body.youtube_url),
        tiktok_url: httpsUrl(body.tiktok_url),
        instagram_url: httpsUrl(body.instagram_url),
        other_links: clean(body.other_links, 500) || null,
        status: 'pending',
      };

      const insert = await fetch(
        `${supabaseUrl}/rest/v1/creator_applications`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(row),
        }
      );

      if (!insert.ok) {
        console.error(await insert.text());
        return res.status(502).json({
          error: 'Could not submit application. Ensure platform-v2.sql was applied.',
        });
      }

      const rows = await insert.json();
      return res.status(201).json({
        success: true,
        application: Array.isArray(rows) ? rows[0] : rows,
        message: 'Application submitted. NXT will review it shortly.',
      });
    }

    // Admin actions (role checked server-side; no shared key)
    const admin = await requireRole(req, res, ADMIN_ROLES);
    if (!admin) return;

    if (action === 'list') {
      const status = clean(body.status, 40);
      let q = `creator_applications?select=*&order=created_at.desc&limit=100`;
      if (status) q += `&status=eq.${encodeURIComponent(status)}`;
      const r = await fetch(`${supabaseUrl}/rest/v1/${q}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      if (!r.ok) {
        console.error(await r.text());
        return res.status(502).json({ error: 'Could not load applications.' });
      }
      return res.status(200).json({
        success: true,
        applications: await r.json(),
      });
    }

    if (action === 'review') {
      const id = clean(body.application_id, 80);
      const decision = clean(body.decision, 20).toLowerCase(); // approved | rejected
      const note = clean(body.note, 2000);
      if (!id || !['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({
          error: 'application_id and decision (approved|rejected) required.',
        });
      }

      const getRes = await fetch(
        `${supabaseUrl}/rest/v1/creator_applications?id=eq.${encodeURIComponent(id)}&select=*`,
        {
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
        }
      );
      const apps = getRes.ok ? await getRes.json() : [];
      const app = Array.isArray(apps) ? apps[0] : null;
      if (!app) return res.status(404).json({ error: 'Application not found.' });

      await fetch(
        `${supabaseUrl}/rest/v1/creator_applications?id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: decision,
            admin_notes: note || app.admin_notes,
            reviewed_at: new Date().toISOString(),
            reviewed_by: admin.user.id,
          }),
        }
      );

      if (decision === 'approved') {
        // Ensure user has creator role + profile when linked
        if (app.user_id) {
          await fetch(`${supabaseUrl}/rest/v1/user_roles`, {
            method: 'POST',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=ignore-duplicates',
            },
            body: JSON.stringify({
              user_id: app.user_id,
              role: 'creator',
            }),
          });

          const slug = String(app.display_name || 'creator')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 60) || 'creator';

          await fetch(`${supabaseUrl}/rest/v1/creator_profiles`, {
            method: 'POST',
            headers: {
              apikey: serviceKey,
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
              Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              user_id: app.user_id,
              display_name: app.display_name,
              slug: `${slug}-${String(app.user_id).slice(0, 6)}`,
              bio: app.bio,
              category: app.category,
              twitch_url: app.twitch_url,
              youtube_url: app.youtube_url,
              tiktok_url: app.tiktok_url,
              instagram_url: app.instagram_url,
              verification_status: 'approved',
            }),
          });

          await rest('rpc/grant_achievement', {
            method: 'POST',
            body: { _user: app.user_id, _slug: 'creator' },
          }).catch(() => {});
        }
      }

      if (app.user_id) {
        await rest('rpc/notify', {
          method: 'POST',
          body: {
            _user: app.user_id,
            _type: 'creator_application',
            _title: decision === 'approved' ? 'Your creator application was approved' : 'Your creator application was reviewed',
            _body: decision === 'approved' ? 'Welcome to the NXT creator network.' : (note || null),
            _link: 'creator-dashboard.html',
          },
        }).catch(() => {});
      }

      await fetch(`${supabaseUrl}/rest/v1/audit_logs`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          actor_id: admin.user.id,
          action: `creator_application_${decision}`,
          entity_type: 'creator_application',
          entity_id: id,
          meta: { email: app.email, note },
        }),
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message:
          decision === 'approved'
            ? 'Creator approved. Role and profile created when user was linked.'
            : 'Application rejected.',
      });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Request failed.' });
  }
};
