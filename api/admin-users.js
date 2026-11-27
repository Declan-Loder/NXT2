/**
 * POST /api/admin-users   (Authorization: Bearer <access token>)
 * Body: { action, ... }
 *   list         { q?, limit? }                       staff
 *   set_status   { user_id, status, reason? }         staff (moderators: suspend/active only)
 *   grant_role   { user_id, role }                    admin (role 'admin' needs superadmin)
 *   revoke_role  { user_id, role }                    admin (role 'admin' needs superadmin)
 *   set_verified { user_id, verified }                admin
 *
 * Rank rules: you may only act on users ranked BELOW you; never on yourself.
 * Suspending/banning also bans the Supabase auth user so existing sessions stop refreshing.
 */
const { requireRole, STAFF_ROLES, UUID_RE, rest, config, limitIp, audit } = require('./_lib/supabase');

const RANK = { superadmin: 3, admin: 2, moderator: 1 };
const rankOf = (roles) => Math.max(0, ...[...roles].map((r) => RANK[r] || 0));
const GRANTABLE = ['creator', 'organiser', 'team', 'community', 'business', 'moderator', 'admin'];

async function setAuthBan(userId, banned) {
  const { url, key } = config();
  const r = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ban_duration: banned ? '876000h' : 'none' }),
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!config().ok) return res.status(500).json({ error: 'Service not configured.' });

  const actor = await requireRole(req, res, STAFF_ROLES);
  if (!actor) return;
  if (!(await limitIp(req, res, 'admin-users', 120, 60))) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const action = String(body.action || '');
  const actorRank = rankOf(actor.roles);
  const isAdmin = actorRank >= RANK.admin;

  try {
    if (action === 'list') {
      const q = String(body.q || '').trim().slice(0, 60);
      const limit = Math.min(Math.max(parseInt(body.limit, 10) || 25, 1), 50);
      let path = `profiles?select=id,username,display_name,email,country,account_status,is_verified,created_at&order=created_at.desc&limit=${limit}`;
      if (UUID_RE.test(q)) {
        path += `&id=eq.${q}`;
      } else if (q) {
        // strip PostgREST filter metacharacters instead of trying to escape them
        const safe = q.replace(/[^\p{L}\p{N}@._ -]/gu, '');
        if (safe) {
          const pat = encodeURIComponent(`*${safe}*`);
          path += `&or=(username.ilike.${pat},display_name.ilike.${pat},email.ilike.${pat})`;
        }
      }
      const r = await rest(path);
      if (!r.ok) throw new Error('list failed');
      const ids = r.data.map((u) => u.id);
      const roleMap = {};
      if (ids.length) {
        const rr = await rest(`user_roles?user_id=in.(${ids.join(',')})&select=user_id,role`);
        (rr.data || []).forEach((x) => (roleMap[x.user_id] ||= []).push(x.role));
      }
      return res.status(200).json({
        users: r.data.map((u) => ({
          ...u,
          roles: roleMap[u.id] || [],
          // moderators do not see email addresses
          email: isAdmin ? u.email : undefined,
        })),
      });
    }

    const userId = String(body.user_id || '');
    if (!UUID_RE.test(userId)) return res.status(400).json({ error: 'Invalid user.' });
    if (userId === actor.user.id) return res.status(400).json({ error: 'You cannot change your own account here.' });

    const targetRoles = new Set(
      ((await rest(`user_roles?user_id=eq.${userId}&select=role`)).data || []).map((x) => x.role)
    );
    if (rankOf(targetRoles) >= actorRank) {
      return res.status(403).json({ error: 'You cannot act on a user of equal or higher rank.' });
    }

    if (action === 'set_status') {
      const status = String(body.status || '');
      if (!['active', 'suspended', 'banned'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
      if (status === 'banned' && !isAdmin) return res.status(403).json({ error: 'Only admins can ban.' });
      const r = await rest(`profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { account_status: status },
      });
      if (!r.ok) throw new Error('update failed');
      const authOk = await setAuthBan(userId, status !== 'active');
      await audit(actor.user.id, `user_${status}`, 'user', userId, {
        reason: String(body.reason || '').slice(0, 500), auth_ban_applied: authOk,
      });
      return res.status(200).json({ success: true, status, auth_ban_applied: authOk });
    }

    if (action === 'grant_role' || action === 'revoke_role') {
      if (!isAdmin) return res.status(403).json({ error: 'Only admins can change roles.' });
      const role = String(body.role || '');
      if (!GRANTABLE.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
      if (role === 'admin' && !actor.roles.has('superadmin')) {
        return res.status(403).json({ error: 'Only a superadmin can grant or revoke admin.' });
      }
      const r = action === 'grant_role'
        ? await rest('user_roles?on_conflict=user_id,role', {
            method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
            body: { user_id: userId, role },
          })
        : await rest(`user_roles?user_id=eq.${userId}&role=eq.${role}`, {
            method: 'DELETE', headers: { Prefer: 'return=minimal' },
          });
      if (!r.ok) throw new Error('role change failed');
      await audit(actor.user.id, action, 'user', userId, { role });
      return res.status(200).json({ success: true });
    }

    if (action === 'set_verified') {
      if (!isAdmin) return res.status(403).json({ error: 'Only admins can verify users.' });
      const verified = body.verified === true;
      const r = await rest(`profiles?id=eq.${userId}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { is_verified: verified },
      });
      if (!r.ok) throw new Error('verify failed');
      await audit(actor.user.id, verified ? 'user_verified' : 'user_unverified', 'user', userId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('admin-users error:', err);
    return res.status(500).json({ error: 'Request failed.' });
  }
};
