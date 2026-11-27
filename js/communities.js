/* Communities: directory, create, detail (posts, members, leaderboard, management). */
(function () {
  const { esc, q, rpc, sb, session, avatar, empty, loading, failed, safeUrl, country, countryOptions, gameOptions, act, ask, confirmDialog, report, uploadImage, timeAgo, toast, param, setMeta, ilikeEscape, requireAuth } = NXT;
  const root = document.getElementById('app');
  const slug = param('slug');
  if (slug) detail(slug); else directory();

  /* ---------- directory + create ---------- */
  async function directory() {
    setMeta('Gaming communities — NXT', 'Join or create South African gaming communities for FC, Fortnite, Rainbow Six and more.');
    root.innerHTML = `<div class="pagehead"><div><div class="kicker">Connect</div><h1>Communities</h1><p>Find your people. Join a community or start your own.</p></div><button class="button" id="new-btn" type="button">Create a community</button></div>
      <div id="create"></div><div class="filters"><input id="cq" type="search" placeholder="Search communities" aria-label="Search communities"><select id="cg" aria-label="Game"></select></div><div id="list" aria-live="polite"></div>`;
    document.getElementById('cg').innerHTML = await gameOptions('', 'All games');
    const list = document.getElementById('list');
    let t;
    const run = async () => {
      loading(list, 4);
      try {
        let qr = sb.from('community_directory').select('slug,name,description,logo_url,member_count,game_name').order('member_count', { ascending: false }).limit(48);
        const term = ilikeEscape(document.getElementById('cq').value);
        if (term) qr = qr.ilike('name', `%${term}%`);
        if (document.getElementById('cg').value) qr = qr.eq('game_id', document.getElementById('cg').value);
        const rows = await q(qr);
        list.innerHTML = rows.length ? `<div class="nxt-grid">${rows.map((c) => `<a class="pcard" href="communities.html?slug=${esc(c.slug)}">${avatar(c)}<div class="meta"><b>${esc(c.name)}</b><small>${Number(c.member_count).toLocaleString()} members${c.game_name ? ' · ' + esc(c.game_name) : ''}</small><small>${esc((c.description || '').slice(0, 70))}</small></div></a>`).join('')}</div>`
          : empty('No communities yet', 'Be the first to create one.', null);
      } catch (e) { failed(list, e, run); }
    };
    document.getElementById('cq').addEventListener('input', () => { clearTimeout(t); t = setTimeout(run, 250); });
    document.getElementById('cg').addEventListener('change', run);
    document.getElementById('new-btn').addEventListener('click', showCreate);
    if (param('new')) showCreate();
    run();
  }

  async function showCreate() {
    const box = document.getElementById('create');
    if (!(await requireAuth(box, 'Sign in to create a community.'))) return;
    box.innerHTML = `<form class="panel stack" id="cform" style="margin-bottom:22px"><h2 style="margin:0">Create a community</h2>
      <div class="form-row"><div class="form-group"><label for="c-name">Name</label><input id="c-name" required minlength="3" maxlength="60" placeholder="FC 26 South Africa"></div>
      <div class="form-group"><label for="c-slug">URL name</label><input id="c-slug" required pattern="[a-z0-9-]{3,40}" maxlength="40" placeholder="fc26-south-africa"></div></div>
      <div class="form-row"><div class="form-group"><label for="c-game">Main game</label><select id="c-game"></select></div><div class="form-group"><label for="c-country">Country</label><select id="c-country">${countryOptions('ZA', 'Any')}</select></div></div>
      <div class="form-group"><label for="c-desc">Description</label><textarea id="c-desc" rows="3" maxlength="2000"></textarea></div>
      <div class="row"><button class="button" type="submit">Create community</button><button class="button outline" type="button" id="c-cancel">Cancel</button></div></form>`;
    document.getElementById('c-game').innerHTML = await gameOptions('', 'No specific game');
    document.getElementById('c-name').addEventListener('input', (e) => { const s = document.getElementById('c-slug'); if (!s.dataset.touched) s.value = e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); });
    document.getElementById('c-slug').addEventListener('input', (e) => (e.target.dataset.touched = '1'));
    document.getElementById('c-cancel').addEventListener('click', () => (box.innerHTML = ''));
    document.getElementById('cform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const id = await act(btn, () => rpc('create_community', { _name: c('c-name'), _slug: c('c-slug'), _description: c('c-desc'), _game: c('c-game') || null, _country: c('c-country') || null }));
      if (id) { toast('Community created!'); location.href = `communities.html?slug=${encodeURIComponent(c('c-slug').toLowerCase())}`; }
    });
    document.getElementById('c-name').focus();
  }
  const c = (id) => document.getElementById(id).value.trim();

  /* ---------- detail ---------- */
  async function detail(slug) {
    loading(root, 3);
    try {
      const s = await session();
      const [row] = await q(sb.from('community_directory').select('*').eq('slug', slug).limit(1));
      if (!row) { root.innerHTML = empty('Community not found', 'It may have been removed or renamed.', 'communities.html', 'Browse communities'); return; }
      const members = await q(sb.from('community_members').select('user_id,role,joined_at').eq('community_id', row.id).order('joined_at').limit(200));
      const ids = members.map((m) => m.user_id);
      const profs = ids.length ? await q(sb.from('profiles').select('id,username,display_name,avatar_url,is_verified').in('id', ids)) : [];
      const pmap = Object.fromEntries(profs.map((p) => [p.id, p]));
      const mine = s && members.find((m) => m.user_id === s.user.id);
      const isMgr = mine && ['owner', 'moderator'].includes(mine.role);
      setMeta(`${row.name} — NXT Communities`, row.description || `${row.name}: a gaming community on NXT.`);
      paint({ row, members, pmap, mine, isMgr, s });
    } catch (e) { failed(root, e, () => detail(slug)); }
  }

  function paint(ctx) {
    const { row, members, pmap, mine, isMgr, s } = ctx;
    root.innerHTML = `<div class="pbanner">${safeUrl(row.banner_url) ? `<img src="${esc(safeUrl(row.banner_url))}" alt="">` : ''}</div>
      <div class="phead">${avatar(row, 'lg')}<div style="flex:1;min-width:200px"><h1>${esc(row.name)}</h1><div class="muted-sm">${members.length.toLocaleString()} members${row.game_name ? ' · ' + esc(row.game_name) : ''}${row.country ? ' · ' + esc(country(row.country)) : ''}</div></div>
        <div class="row"><button class="button${mine ? ' outline' : ''}" id="join" type="button">${mine ? (mine.role === 'owner' ? 'Owner' : 'Leave') : 'Join'}</button><button class="button outline" id="rep" type="button">Report</button></div></div>
      <div style="margin-top:22px" class="tabs" role="tablist" id="ctabs"></div><div id="pane"></div>`;
    const TABS = [['posts', 'Posts'], ['members', 'Members'], ['about', 'About & rules'], ['board', 'Leaderboard']];
    if (isMgr) TABS.push(['manage', 'Manage']);
    const tabsEl = document.getElementById('ctabs');
    const show = (k) => { tabsEl.innerHTML = TABS.map(([t, l]) => `<button role="tab" type="button" aria-selected="${t === k}" data-t="${t}">${l}</button>`).join(''); tabsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => show(b.dataset.t))); ({ posts, members: memberTab, about, board, manage })[k](ctx); };
    show('posts');
    const jb = document.getElementById('join');
    jb.addEventListener('click', async () => {
      if (!s) { location.href = 'player-login.html?next=' + encodeURIComponent(`communities.html?slug=${row.slug}`); return; }
      if (mine?.role === 'owner') return;
      const ok = await act(jb, () => rpc(mine ? 'leave_community' : 'join_community', { _cid: row.id }), mine ? 'You left the community.' : 'Welcome! You joined.');
      if (ok !== undefined) detail(row.slug);
    });
    document.getElementById('rep').addEventListener('click', () => report('community', row.id));
  }

  async function posts({ row, mine, isMgr, pmap }) {
    const pane = document.getElementById('pane');
    pane.innerHTML = `${mine ? `<form class="panel stack" id="pform" style="margin-bottom:16px"><label class="sr-only" for="pbody">Write a post</label><textarea id="pbody" rows="3" maxlength="4000" required placeholder="Share something with the community"></textarea><div class="row between">${isMgr ? '<label class="muted-sm"><input type="checkbox" id="pann" style="width:auto"> Post as announcement</label>' : '<span></span>'}<button class="button" type="submit">Post</button></div></form>` : '<p class="muted">Join this community to post.</p>'}<div id="feed" class="stack" aria-live="polite"></div>`;
    const feed = document.getElementById('feed');
    const load = async () => {
      loading(feed, 3);
      try {
        const rows = await q(sb.from('community_posts').select('id,author_id,body,is_announcement,created_at').eq('community_id', row.id).order('is_announcement', { ascending: false }).order('created_at', { ascending: false }).limit(30));
        const missing = [...new Set(rows.map((r) => r.author_id).filter((i) => !pmap[i]))];
        if (missing.length) (await q(sb.from('profiles').select('id,username,display_name,avatar_url,is_verified').in('id', missing))).forEach((p) => (pmap[p.id] = p));
        const me = (await session())?.user.id;
        feed.innerHTML = rows.length ? rows.map((r) => { const a = pmap[r.author_id] || {}; return `<article class="post${r.is_announcement ? ' ann' : ''}"><div class="row between"><a class="row" href="profile.html?id=${esc(r.author_id)}">${avatar(a, 'sm')}<b>${esc(a.display_name || a.username || 'Member')}</b>${r.is_announcement ? '<span class="chip lime">Announcement</span>' : ''}<span class="muted-sm">${timeAgo(r.created_at)}</span></a><span class="row">${r.author_id === me || isMgr ? `<button class="button outline btn-sm" data-del="${r.id}" type="button">Delete</button>` : `<button class="button outline btn-sm" data-rep="${r.id}" type="button">Report</button>`}</span></div><p>${esc(r.body)}</p></article>`; }).join('')
          : empty('No posts yet', 'Start the conversation.');
        feed.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Delete this post?', 'Delete')) { const r = await act(b, () => q(sb.from('community_posts').delete().eq('id', b.dataset.del)), 'Post deleted.'); if (r !== undefined) load(); } }));
        feed.querySelectorAll('[data-rep]').forEach((b) => b.addEventListener('click', () => report('post', b.dataset.rep)));
      } catch (e) { failed(feed, e, load); }
    };
    document.getElementById('pform')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = document.getElementById('pbody');
      const ok = await act(e.submitter, () => rpc('post_to_community', { _cid: row.id, _body: body.value, _announcement: !!document.getElementById('pann')?.checked }), 'Posted.');
      if (ok) { body.value = ''; load(); }
    });
    load();
  }

  function memberTab({ row, members, pmap, mine }) {
    const pane = document.getElementById('pane');
    const isOwner = mine?.role === 'owner', isMgr = mine && ['owner', 'moderator'].includes(mine.role);
    const ord = { owner: 0, moderator: 1, member: 2 };
    pane.innerHTML = `<div class="stack">${[...members].sort((a, b) => ord[a.role] - ord[b.role]).map((m) => { const p = pmap[m.user_id] || {}; return `<div class="pcard"><a class="row" style="flex:1;min-width:0" href="profile.html?id=${esc(m.user_id)}">${avatar(p)}<div class="meta"><b>${esc(p.display_name || p.username || 'Member')}</b><small>@${esc(p.username || '')} · ${esc(m.role)}</small></div></a>${isMgr && m.role !== 'owner' && !(m.role === 'moderator' && !isOwner) ? `<span class="row">${isOwner ? `<button class="button outline btn-sm" data-role="${m.user_id}:${m.role === 'moderator' ? 'member' : 'moderator'}" type="button">${m.role === 'moderator' ? 'Remove mod' : 'Make mod'}</button>` : ''}<button class="button danger btn-sm" data-kick="${m.user_id}" type="button">Remove</button></span>` : ''}</div>`; }).join('')}</div>`;
    pane.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click', async () => { if (await confirmDialog('Remove this member?', 'Remove')) { const r = await act(b, () => rpc('remove_community_member', { _cid: row.id, _user: b.dataset.kick }), 'Member removed.'); if (r !== undefined) detail(row.slug); } }));
    pane.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', async () => { const [u, role] = b.dataset.role.split(':'); const r = await act(b, () => rpc('set_community_role', { _cid: row.id, _user: u, _role: role }), 'Role updated.'); if (r !== undefined) detail(row.slug); }));
  }

  async function about({ row }) {
    const [full] = await q(sb.from('communities').select('description,rules').eq('id', row.id).limit(1)).catch(() => [{}]);
    document.getElementById('pane').innerHTML = `<div class="panel"><h2 style="margin-top:0">About</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(full?.description || 'No description yet.')}</p><h2>Rules</h2><p style="white-space:pre-wrap;overflow-wrap:anywhere" class="muted">${esc(full?.rules || 'The community has not set any rules yet.')}</p></div>`;
  }

  async function board({ row }) {
    const pane = document.getElementById('pane');
    loading(pane, 3);
    try {
      const rows = await rpc('leaderboard', { _game: row.game_id || null, _community: row.id, _limit: 25 });
      pane.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Played</th><th>W</th><th>${row.game_id ? 'Rating' : 'XP'}</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="rk">${r.rank}</td><td><a class="who" href="profile.html?id=${esc(r.user_id)}">${avatar(r, 'sm')}${esc(r.display_name || r.username)}</a></td><td>${r.played}</td><td>${r.wins}</td><td>${r.score}</td></tr>`).join('')}</tbody></table></div>`
        : empty('No rankings yet', 'Members appear here after confirmed ranked matches.', 'challenges.html', 'Play a ranked match');
    } catch (e) { failed(pane, e, () => board({ row })); }
  }

  async function manage({ row }) {
    const [full] = await q(sb.from('communities').select('description,rules').eq('id', row.id).limit(1));
    const pane = document.getElementById('pane');
    pane.innerHTML = `<form class="panel stack" id="mform"><h2 style="margin:0">Community settings</h2>
      <div class="form-group"><label for="m-desc">Description</label><textarea id="m-desc" rows="3" maxlength="2000">${esc(full.description || '')}</textarea></div>
      <div class="form-group"><label for="m-rules">Rules</label><textarea id="m-rules" rows="5" maxlength="4000">${esc(full.rules || '')}</textarea></div>
      <div class="form-row"><div class="form-group"><label for="m-logo">Logo (JPG/PNG/WebP, max 2 MB)</label><input id="m-logo" type="file" accept="image/jpeg,image/png,image/webp"></div><div class="form-group"><label for="m-banner">Banner</label><input id="m-banner" type="file" accept="image/jpeg,image/png,image/webp"></div></div>
      <div class="row between"><button class="button" type="submit">Save changes</button><button class="button danger" type="button" id="m-del">Delete community</button></div></form>`;
    document.getElementById('mform').addEventListener('submit', async (e) => {
      e.preventDefault();
      await act(e.submitter, async () => {
        const upd = { description: c('m-desc') || null, rules: c('m-rules') || null };
        const lf = document.getElementById('m-logo').files[0], bf = document.getElementById('m-banner').files[0];
        if (lf) upd.logo_url = await uploadImage(lf, 'community-logo');
        if (bf) upd.banner_url = await uploadImage(bf, 'community-banner');
        await q(sb.from('communities').update(upd).eq('id', row.id));
      }, 'Saved.');
      detail(row.slug);
    });
    document.getElementById('m-del').addEventListener('click', async () => {
      if (!(await confirmDialog(`Permanently delete “${row.name}”? Members and posts are removed. This cannot be undone.`, 'Delete forever'))) return;
      const r = await act(null, () => q(sb.from('communities').delete().eq('id', row.id)), 'Community deleted.');
      if (r !== undefined) location.href = 'communities.html';
    });
  }
})();
