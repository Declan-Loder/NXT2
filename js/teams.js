/* Teams: directory, create, roster, invites, management. */
(function () {
  const { esc, q, rpc, sb, session, avatar, empty, loading, failed, safeUrl, gameOptions, act, confirmDialog, report, uploadImage, toast, param, setMeta, ilikeEscape, requireAuth } = NXT;
  const root = document.getElementById('app');
  const slug = param('slug');
  const v = (id) => document.getElementById(id).value.trim();
  if (slug) detail(slug); else directory();

  async function directory() {
    setMeta('Gaming teams — NXT', 'Create or join a gaming team on NXT. Manage your roster and compete together.');
    root.innerHTML = `<div class="pagehead"><div><div class="kicker">Compete together</div><h1>Teams</h1><p>Build a roster, invite players and represent your organisation.</p></div><button class="button" id="new-btn" type="button">Create a team</button></div><div id="invites"></div><div id="create"></div><div class="filters"><input id="tq" type="search" placeholder="Search teams" aria-label="Search teams"></div><div id="list" aria-live="polite"></div>`;
    const list = document.getElementById('list');
    let t;
    const run = async () => {
      loading(list, 4);
      try {
        let qr = sb.from('teams').select('slug,name,tag,logo_url,games(name)').order('created_at', { ascending: false }).limit(48);
        const term = ilikeEscape(document.getElementById('tq').value);
        if (term) qr = qr.ilike('name', `%${term}%`);
        const rows = await q(qr);
        list.innerHTML = rows.length ? `<div class="nxt-grid">${rows.map((x) => `<a class="pcard" href="teams.html?slug=${esc(x.slug)}">${avatar(x)}<div class="meta"><b>${esc(x.name)}</b><small>${x.tag ? '[' + esc(x.tag) + '] ' : ''}${esc(x.games?.name || '')}</small></div></a>`).join('')}</div>` : empty('No teams yet', 'Be the first to create one.');
      } catch (e) { failed(list, e, run); }
    };
    document.getElementById('tq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
    document.getElementById('new-btn').addEventListener('click', showCreate);
    if (param('new')) showCreate();
    run(); myInvites();
  }

  async function myInvites() {
    const s = await session(); if (!s) return;
    try {
      const rows = await q(sb.from('team_members').select('team_id,teams(name,slug)').eq('user_id', s.user.id).eq('status', 'invited'));
      if (!rows.length) return;
      const box = document.getElementById('invites');
      box.innerHTML = `<h2 class="section-title">Your invitations</h2><div class="stack" style="margin-bottom:22px">${rows.map((r) => `<div class="panel row between"><b>${esc(r.teams?.name)}</b><span class="row"><button class="button btn-sm" data-a="1" data-t="${r.team_id}" type="button">Accept</button><button class="button outline btn-sm" data-a="0" data-t="${r.team_id}" type="button">Decline</button></span></div>`).join('')}</div>`;
      box.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => { const r = await act(b, () => rpc('respond_team_invite', { _tid: b.dataset.t, _accept: b.dataset.a === '1' }), b.dataset.a === '1' ? 'You joined the team.' : 'Invitation declined.'); if (r !== undefined) directory(); }));
    } catch { /* invitations are optional */ }
  }

  async function showCreate() {
    const box = document.getElementById('create');
    if (!(await requireAuth(box, 'Sign in to create a team.'))) return;
    box.innerHTML = `<form class="panel stack" id="tform" style="margin-bottom:22px"><h2 style="margin:0">Create a team</h2>
      <div class="form-row"><div class="form-group"><label for="t-name">Team name</label><input id="t-name" required minlength="2" maxlength="40" placeholder="NXT"></div><div class="form-group"><label for="t-tag">Tag (2–5)</label><input id="t-tag" maxlength="5" pattern="[A-Za-z0-9]{2,5}" placeholder="NXT"></div></div>
      <div class="form-row"><div class="form-group"><label for="t-slug">URL name</label><input id="t-slug" required pattern="[a-z0-9-]{2,40}" maxlength="40" placeholder="nxt"></div><div class="form-group"><label for="t-game">Main game</label><select id="t-game"></select></div></div>
      <div class="form-group"><label for="t-desc">Description</label><textarea id="t-desc" rows="3" maxlength="2000"></textarea></div>
      <div class="row"><button class="button" type="submit">Create team</button><button class="button outline" type="button" id="t-cancel">Cancel</button></div></form>`;
    document.getElementById('t-game').innerHTML = await gameOptions('', 'No specific game');
    document.getElementById('t-name').addEventListener('input', (e) => { const s2 = document.getElementById('t-slug'); if (!s2.dataset.touched) s2.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); });
    document.getElementById('t-slug').addEventListener('input', (e) => (e.target.dataset.touched = '1'));
    document.getElementById('t-cancel').addEventListener('click', () => (box.innerHTML = ''));
    document.getElementById('tform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = await act(e.submitter, () => rpc('create_team', { _name: v('t-name'), _slug: v('t-slug'), _tag: v('t-tag') || null, _description: v('t-desc') || null, _game: v('t-game') || null }));
      if (id) { toast('Team created!'); location.href = `teams.html?slug=${encodeURIComponent(v('t-slug').toLowerCase())}`; }
    });
  }

  async function detail(slug) {
    loading(root, 3);
    try {
      const s = await session();
      const [team] = await q(sb.from('teams').select('*,games(name)').eq('slug', slug).limit(1));
      if (!team) { root.innerHTML = empty('Team not found', 'It may have been renamed or deleted.', 'teams.html', 'Browse teams'); return; }
      const members = await q(sb.from('team_members').select('user_id,role,status,joined_at').eq('team_id', team.id).order('created_at'));
      const ids = members.map((m) => m.user_id);
      const profs = ids.length ? await q(sb.from('profiles').select('id,username,display_name,avatar_url,is_verified').in('id', ids)) : [];
      const pmap = Object.fromEntries(profs.map((p) => [p.id, p]));
      const stats = team.game_id && ids.length ? await q(sb.from('player_stats').select('user_id,played,wins,rating').eq('game_id', team.game_id).in('user_id', ids)) : [];
      const smap = Object.fromEntries(stats.map((r) => [r.user_id, r]));
      const mine = s && members.find((m) => m.user_id === s.user.id);
      const mgr = mine && mine.status === 'active' && ['owner', 'manager'].includes(mine.role);
      const owner = mine && mine.status === 'active' && mine.role === 'owner';
      const active = members.filter((m) => m.status === 'active');
      const invited = members.filter((m) => m.status === 'invited');
      setMeta(`${team.name} — NXT Teams`, team.description || `${team.name}, a gaming team on NXT.`);

      const wins = active.reduce((a, m) => a + (smap[m.user_id]?.wins || 0), 0), played = active.reduce((a, m) => a + (smap[m.user_id]?.played || 0), 0);
      root.innerHTML = `<div class="pbanner">${safeUrl(team.banner_url) ? `<img src="${esc(safeUrl(team.banner_url))}" alt="">` : ''}</div>
        <div class="phead">${avatar(team, 'lg')}<div style="flex:1;min-width:200px"><h1>${esc(team.name)}${team.tag ? ` <span class="chip">${esc(team.tag)}</span>` : ''}</h1><div class="muted-sm">${active.length} members${team.games?.name ? ' · ' + esc(team.games.name) : ''}</div></div>
          <div class="row">${mine?.status === 'active' && !owner ? '<button class="button outline" id="leave" type="button">Leave team</button>' : ''}<button class="button outline" id="rep" type="button">Report</button></div></div>
        ${mine?.status === 'invited' ? `<div class="panel row between" style="margin-top:20px"><b>You’ve been invited to join ${esc(team.name)}.</b><span class="row"><button class="button btn-sm" data-r="1" type="button">Accept</button><button class="button outline btn-sm" data-r="0" type="button">Decline</button></span></div>` : ''}
        <div class="pstats"><div><b>${played}</b><span>Matches (members)</span></div><div><b>${wins}</b><span>Wins</span></div><div><b>${played ? Math.round((100 * wins) / played) : 0}%</b><span>Win rate</span></div></div>
        <div class="cols" style="margin-top:22px"><div>
          ${team.description ? `<p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(team.description)}</p>` : ''}
          <h2 class="section-title">Roster</h2>
          <div class="stack">${active.map((m) => rosterRow(m, pmap[m.user_id] || {}, smap[m.user_id], team, mgr, owner)).join('')}</div>
          ${mgr && invited.length ? `<h2 class="section-title">Pending invites</h2><div class="stack">${invited.map((m) => `<div class="pcard">${avatar(pmap[m.user_id] || {})}<div class="meta"><b>@${esc(pmap[m.user_id]?.username || '')}</b><small>Invited</small></div><button class="button danger btn-sm" data-kick="${m.user_id}" type="button" style="margin-left:auto">Cancel</button></div>`).join('')}</div>` : ''}
        </div><aside>${mgr ? manageHtml() : ''}</aside></div>`;
      wire({ team, mgr, owner, mine });
    } catch (e) { failed(root, e, () => detail(slug)); }
  }

  const rosterRow = (m, p, st, team, mgr, owner) => `<div class="pcard"><a class="row" style="flex:1;min-width:0" href="profile.html?id=${esc(m.user_id)}">${avatar(p)}<div class="meta"><b>${esc(p.display_name || p.username || 'Player')}</b><small>@${esc(p.username || '')} · ${esc(m.role)}${st ? ' · rating ' + st.rating : ''}</small></div></a>${mgr && m.role !== 'owner' && !(m.role === 'manager' && !owner) ? `<span class="row">${owner ? `<select data-role="${m.user_id}" aria-label="Role for ${esc(p.username || 'member')}" style="width:auto">${['manager', 'player', 'substitute'].map((r) => `<option${r === m.role ? ' selected' : ''}>${r}</option>`).join('')}</select>` : ''}<button class="button danger btn-sm" data-kick="${m.user_id}" type="button">Remove</button></span>` : ''}</div>`;

  const manageHtml = () => `<h2 class="section-title" style="margin-top:0">Manage team</h2><form class="panel stack" id="inv"><label for="inv-u">Invite player by username</label><input id="inv-u" required placeholder="username" maxlength="20" autocomplete="off"><button class="button btn-sm" type="submit">Send invite</button></form>
    <form class="panel stack" id="edit" style="margin-top:12px"><label for="e-desc">Description</label><textarea id="e-desc" rows="3" maxlength="2000"></textarea><label for="e-logo">Logo</label><input id="e-logo" type="file" accept="image/jpeg,image/png,image/webp"><label for="e-banner">Banner</label><input id="e-banner" type="file" accept="image/jpeg,image/png,image/webp"><button class="button btn-sm" type="submit">Save</button></form>
    <button class="button danger btn-sm" id="del" type="button" style="margin-top:12px;display:none">Delete team</button>`;

  function wire({ team, mgr, owner, mine }) {
    const again = () => detail(team.slug);
    document.getElementById('rep')?.addEventListener('click', () => report('team', team.id));
    document.getElementById('leave')?.addEventListener('click', async (e) => { if (await confirmDialog('Leave this team?', 'Leave')) { const r = await act(e.target, () => rpc('leave_team', { _tid: team.id }), 'You left the team.'); if (r !== undefined) again(); } });
    root.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => { const r = await act(b, () => rpc('respond_team_invite', { _tid: team.id, _accept: b.dataset.r === '1' })); if (r !== undefined) again(); }));
    root.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Remove this player?', 'Remove')) { const r = await act(b, () => rpc('remove_team_member', { _tid: team.id, _user: b.dataset.kick }), 'Removed.'); if (r !== undefined) again(); } }));
    root.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => { const r = await act(s, () => rpc('set_team_role', { _tid: team.id, _user: s.dataset.role, _role: s.value }), 'Role updated.'); if (r === undefined) again(); }));
    if (!mgr) return;
    document.getElementById('e-desc').value = team.description || '';
    document.getElementById('inv').addEventListener('submit', async (e) => { e.preventDefault(); const r = await act(e.submitter, () => rpc('invite_to_team', { _tid: team.id, _username: v('inv-u') }), 'Invitation sent.'); if (r !== undefined) again(); });
    document.getElementById('edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      await act(e.submitter, async () => {
        const upd = { description: v('e-desc') || null };
        const lf = document.getElementById('e-logo').files[0], bf = document.getElementById('e-banner').files[0];
        if (lf) upd.logo_url = await uploadImage(lf, 'team-logo');
        if (bf) upd.banner_url = await uploadImage(bf, 'team-banner');
        await q(sb.from('teams').update(upd).eq('id', team.id));
      }, 'Saved.');
      again();
    });
    if (owner) {
      const d = document.getElementById('del'); d.style.display = '';
      d.addEventListener('click', async () => { if (await confirmDialog(`Permanently delete “${team.name}”?`, 'Delete forever')) { const r = await act(d, () => q(sb.from('teams').delete().eq('id', team.id)), 'Team deleted.'); if (r !== undefined) location.href = 'teams.html'; } });
    }
  }
})();
