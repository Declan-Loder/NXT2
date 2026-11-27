/* Admin console additions: overview, reports queue, disputes, users. All permission checks are server-side
   (RLS / SECURITY DEFINER RPCs / /api/admin-users); this file only renders. */
(function () {
  const { esc, q, rpc, sb, session, act, ask, confirmDialog, timeAgo, toast, friendly } = NXT;
  const $ = (id) => document.getElementById(id);
  const KPI = [['users', 'Users'], ['active_30d', 'Active (30d)'], ['creators', 'Creators'], ['teams', 'Teams'], ['communities', 'Communities'], ['tournaments', 'Tournaments'], ['challenges', 'Matches played'], ['open_reports', 'Open reports'], ['open_disputes', 'Disputes'], ['pending_creators', 'Creator applications'], ['revenue_zar', 'Revenue (paid)']];

  async function overview() {
    try {
      const o = await rpc('admin_overview');
      $('ov').innerHTML = KPI.filter(([k]) => o[k] !== null && o[k] !== undefined).map(([k, l]) => `<div class="kpi"><b>${k === 'revenue_zar' ? 'R ' + Number(o[k]).toLocaleString('en-ZA', { minimumFractionDigits: 2 }) : Number(o[k]).toLocaleString()}</b><span>${l}</span></div>`).join('') + '<div class="kpi"><b>—</b><span>Live creators (no stream integration configured)</span></div>';
    } catch (e) { $('ov').innerHTML = `<div class="nxt-error" role="alert">${esc(friendly(e))}</div>`; }
  }

  /* ---- reports ---- */
  async function reports() {
    const list = $('rp-list'); NXT.loading(list, 2);
    try {
      const rows = await q(sb.from('reports').select('*').eq('status', $('rp-status').value).order('created_at', { ascending: false }).limit(50));
      if (!rows.length) { list.innerHTML = NXT.empty('Nothing here', 'No reports with this status.'); return; }
      const ids = [...new Set(rows.flatMap((r) => [r.reporter_id, r.target_user_id]).filter(Boolean))];
      const ps = ids.length ? await q(sb.from('profiles').select('id,username').in('id', ids)) : [];
      const un = Object.fromEntries(ps.map((p) => [p.id, p.username]));
      const acts = await q(sb.from('report_actions').select('report_id,action,note,created_at').in('report_id', rows.map((r) => r.id)).order('created_at'));
      list.innerHTML = rows.map((r) => `<article class="mcard"><div class="row between"><span><span class="chip warn">${esc(r.target_type)}</span> <span class="chip">${esc(r.reason.replace('_', ' '))}</span></span><span class="muted-sm">${timeAgo(r.created_at)}</span></div>
        <div>Reported by <b>${esc(un[r.reporter_id] || 'deleted user')}</b>${r.target_user_id ? ` · target user <a href="profile.html?id=${esc(r.target_user_id)}"><b>@${esc(un[r.target_user_id] || 'unknown')}</b></a>` : ''}</div>
        ${r.details ? `<div class="muted" style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(r.details)}</div>` : ''}<div class="muted-sm">Target ID: ${esc(r.target_id)}</div>
        ${acts.filter((a) => a.report_id === r.id).map((a) => `<div class="muted-sm">• ${esc(a.action)}${a.note ? ': ' + esc(a.note) : ''} (${timeAgo(a.created_at)})</div>`).join('')}
        <div class="row">${['reviewing', 'resolved', 'dismissed', 'escalated'].filter((s) => s !== r.status).map((s) => `<button class="button outline btn-sm" data-s="${s}" data-id="${r.id}" type="button">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}<button class="button outline btn-sm" data-assign="${r.id}" type="button">Assign to me</button><button class="button outline btn-sm" data-note="${r.id}" type="button">Add note</button>
        ${r.target_type === 'post' || r.target_type === 'message' ? `<button class="button danger btn-sm" data-mod="remove_content" data-id="${r.id}" type="button">Remove content</button>` : ''}${r.target_type === 'community' ? `<button class="button danger btn-sm" data-mod="suspend_community" data-id="${r.id}" type="button">Suspend community</button>` : ''}</div></article>`).join('');
      const done = (b, fn) => b.addEventListener('click', async () => { const r = await act(b, fn, 'Updated.'); if (r !== undefined) reports().then(overview); });
      list.querySelectorAll('[data-s]').forEach((b) => done(b, async () => { const v = await ask({ title: `Mark as ${b.dataset.s}`, submit: 'Save', fields: [{ name: 'n', label: 'Note (optional)', type: 'textarea', max: 1000 }] }); if (!v) throw new Error('Cancelled'); return rpc('staff_update_report', { _id: b.dataset.id, _status: b.dataset.s, _note: v.n || null }); }));
      list.querySelectorAll('[data-assign]').forEach((b) => done(b, () => rpc('staff_update_report', { _id: b.dataset.assign, _assign_me: true })));
      list.querySelectorAll('[data-note]').forEach((b) => done(b, async () => { const v = await ask({ title: 'Add note', submit: 'Save', fields: [{ name: 'n', label: 'Note', type: 'textarea', required: true, max: 1000 }] }); if (!v) throw new Error('Cancelled'); return rpc('staff_update_report', { _id: b.dataset.note, _note: v.n }); }));
      list.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog('Apply this moderation action? It cannot be undone.', 'Apply'))) return; const r = await act(b, () => rpc('moderate_content', { _report: b.dataset.id, _action: b.dataset.mod }), 'Action applied.'); if (r !== undefined) reports().then(overview); }));
    } catch (e) { NXT.failed(list, e, reports); }
  }

  /* ---- disputes ---- */
  async function disputes() {
    const list = $('dp-list'); NXT.loading(list, 1);
    try {
      const rows = await q(sb.from('challenges').select('*').eq('status', 'disputed').order('updated_at').limit(30));
      if (!rows.length) { list.innerHTML = NXT.empty('No disputed matches', 'Disputed results will appear here.'); return; }
      const ps = await q(sb.from('profiles').select('id,username').in('id', [...new Set(rows.flatMap((r) => [r.challenger_id, r.opponent_id]))]));
      const un = Object.fromEntries(ps.map((p) => [p.id, p.username]));
      list.innerHTML = rows.map((r) => `<article class="mcard"><div class="vs"><span>@${esc(un[r.challenger_id])}</span><span class="score">${r.challenger_score} – ${r.opponent_score}</span><span>@${esc(un[r.opponent_id])}</span></div><div class="muted-sm">Reported by @${esc(un[r.reported_by] || '?')}${r.evidence_url && /^https:\/\//.test(r.evidence_url) ? ` · <a href="${esc(r.evidence_url)}" target="_blank" rel="noopener noreferrer nofollow">evidence ↗</a>` : ''}</div><div>Dispute: <span class="muted" style="white-space:pre-wrap">${esc(r.dispute_reason || '')}</span></div><div><button class="button btn-sm" data-id="${r.id}" type="button">Set final score</button></div></article>`).join('');
      list.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
        const v = await ask({ title: 'Final score', submit: 'Resolve', fields: [{ name: 'a', label: 'Challenger score', type: 'number', required: true }, { name: 'b', label: 'Opponent score', type: 'number', required: true }, { name: 'n', label: 'Internal note', type: 'textarea', max: 500 }] });
        if (!v) return;
        const r = await act(b, () => rpc('resolve_dispute', { _id: b.dataset.id, _challenger_score: Number(v.a), _opponent_score: Number(v.b), _note: v.n || null }), 'Dispute resolved.');
        if (r !== undefined) disputes().then(overview);
      }));
    } catch (e) { NXT.failed(list, e, disputes); }
  }

  /* ---- users (server API; role rules enforced there) ---- */
  async function api(body) {
    const s = await session();
    const r = await fetch('/api/admin-users', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (s?.access_token || '') }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Request failed.');
    return j;
  }
  async function users(term) {
    const list = $('us-list'); NXT.loading(list, 2);
    try {
      const { users: rows } = await api({ action: 'list', q: term || '' });
      list.innerHTML = rows.length ? rows.map((u) => `<article class="mcard"><div class="row between"><span><b>${esc(u.display_name || u.username || '(no name)')}</b> <span class="muted-sm">@${esc(u.username || '')}${u.email ? ' · ' + esc(u.email) : ''}</span></span><span class="chip ${u.account_status === 'active' ? 'lime' : 'bad'}">${esc(u.account_status)}</span></div>
        <div class="row">${(u.roles || []).map((r) => `<span class="chip">${esc(r)}</span>`).join('')}${u.is_verified ? '<span class="chip lime">verified</span>' : ''}</div>
        <div class="row"><a class="button outline btn-sm" href="profile.html?id=${esc(u.id)}">View</a>${u.account_status === 'active' ? `<button class="button outline btn-sm" data-st="suspended" data-id="${u.id}" type="button">Suspend</button><button class="button danger btn-sm" data-st="banned" data-id="${u.id}" type="button">Ban</button>` : `<button class="button btn-sm" data-st="active" data-id="${u.id}" type="button">Reinstate</button>`}
        <button class="button outline btn-sm" data-vf="${u.is_verified ? 0 : 1}" data-id="${u.id}" type="button">${u.is_verified ? 'Unverify' : 'Verify'}</button><button class="button outline btn-sm" data-role="grant_role" data-id="${u.id}" type="button">Grant role</button><button class="button outline btn-sm" data-role="revoke_role" data-id="${u.id}" type="button">Revoke role</button></div></article>`).join('') : NXT.empty('No users found', 'Try a different search.');
      const run = (b, fn, msg) => b.addEventListener('click', async () => { const r = await act(b, fn, msg); if (r !== undefined) users($('us-q').value); });
      list.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', async () => { if (b.dataset.st !== 'active' && !(await confirmDialog(`${b.dataset.st === 'banned' ? 'Ban' : 'Suspend'} this user? Their sessions will stop working.`, b.dataset.st === 'banned' ? 'Ban' : 'Suspend'))) return; const r = await act(b, () => api({ action: 'set_status', user_id: b.dataset.id, status: b.dataset.st }), 'Updated.'); if (r !== undefined) users($('us-q').value); }));
      list.querySelectorAll('[data-vf]').forEach((b) => run(b, () => api({ action: 'set_verified', user_id: b.dataset.id, verified: b.dataset.vf === '1' }), 'Updated.'));
      list.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => { const v = await ask({ title: b.dataset.role === 'grant_role' ? 'Grant role' : 'Revoke role', submit: 'Apply', fields: [{ name: 'r', label: 'Role', type: 'select', options: ['creator', 'organiser', 'team', 'community', 'business', 'moderator', 'admin'].map((x) => [x, x]) }] }); if (!v) return; const r = await act(b, () => api({ action: b.dataset.role, user_id: b.dataset.id, role: v.r }), 'Updated.'); if (r !== undefined) users($('us-q').value); }));
    } catch (e) { NXT.failed(list, e, () => users(term)); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (!(await session())) { $('ov').innerHTML = '<p class="muted">Sign in with an admin or moderator account to use the console.</p>'; return; }
    overview(); disputes(); users('');
    $('rp-load').addEventListener('click', reports);
    $('us-form').addEventListener('submit', (e) => { e.preventDefault(); users($('us-q').value.trim()); });
    reports();
  });
})();
