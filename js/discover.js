/* Discover: global search + directories (creators, gamers, competitive, teams, communities, games). */
(function () {
  const { esc, q, rpc, avatar, verified, empty, loading, failed, country, countryOptions, gameOptions, ilikeEscape, sb, safeUrl, param, setMeta } = NXT;
  const root = document.getElementById('results');
  const qInput = document.getElementById('q');
  const filters = document.getElementById('filters');
  const tabsEl = document.getElementById('tabs');
  const PAGE = 24;
  const TABS = [['creator', 'Creators'], ['gamer', 'Gamers'], ['competitive', 'Competitive'], ['teams', 'Teams'], ['communities', 'Communities'], ['games', 'Games']];
  let tab = TABS.some((t) => t[0] === param('tab')) ? param('tab') : 'creator';
  let offset = 0;
  let timer;

  const personCard = (p) => `<a class="pcard" href="profile.html?id=${esc(p.id)}">${avatar(p)}<div class="meta"><b>${esc(p.display_name || p.username)}${verified(p.is_verified)}</b><small>@${esc(p.username)}${p.country ? ' · ' + esc(country(p.country)) : ''}${p.creator_category ? ' · ' + esc(p.creator_category) : ''}</small><small>${Number(p.followers || 0)} followers${p.rating ? ' · rating ' + p.rating : ''}</small></div></a>`;
  const teamCard = (t) => `<a class="pcard" href="teams.html?slug=${esc(t.slug)}">${avatar(t, 'md')}<div class="meta"><b>${esc(t.name)}</b><small>${t.tag ? '[' + esc(t.tag) + '] ' : ''}${esc(t.games?.name || 'Team')}</small></div></a>`;
  const commCard = (c) => `<a class="pcard" href="communities.html?slug=${esc(c.slug)}">${avatar(c, 'md')}<div class="meta"><b>${esc(c.name)}</b><small>${Number(c.member_count || 0).toLocaleString()} members${c.game_name ? ' · ' + esc(c.game_name) : ''}</small></div></a>`;
  const gameCard = (g) => `<a class="pcard" href="games.html?slug=${esc(g.slug)}">${avatar({ name: g.name, avatar_url: g.cover_url })}<div class="meta"><b>${esc(g.name)}</b><small>Players, matches &amp; leaderboards</small></div></a>`;

  function renderFilters() {
    const people = ['creator', 'gamer', 'competitive'].includes(tab);
    const withGame = ['gamer', 'competitive', 'teams', 'communities'].includes(tab);
    if (tab === 'games') { filters.innerHTML = ''; return Promise.resolve(); }
    return gameOptions(filters.dataset.game || '', 'All games').then((opts) => {
      filters.innerHTML = (withGame ? `<select id="f-game" aria-label="Game">${opts}</select>` : '') +
        (people || tab === 'communities' ? `<select id="f-country" aria-label="Country">${countryOptions(filters.dataset.country || '', 'All countries')}</select>` : '');
      filters.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
        filters.dataset.game = filters.querySelector('#f-game')?.value || '';
        filters.dataset.country = filters.querySelector('#f-country')?.value || '';
        load(true);
      }));
    });
  }

  async function load(reset) {
    if (reset) { offset = 0; loading(root, 6); }
    const game = filters.querySelector('#f-game')?.value || null;
    const ctry = filters.querySelector('#f-country')?.value || null;
    try {
      let rows, card, none;
      if (['creator', 'gamer', 'competitive'].includes(tab)) {
        rows = await rpc('discover_people', { _kind: tab, _game: game, _country: ctry, _limit: PAGE, _offset: offset });
        card = personCard;
        none = tab === 'creator' ? ['No creators yet', 'Approved creators will appear here.', 'creator-apply.html', 'Apply as a creator']
          : tab === 'competitive' ? ['No ranked players yet', 'Players appear after their first confirmed match.', 'challenges.html', 'Challenge someone']
          : ['No players match', 'Try removing a filter.'];
      } else if (tab === 'teams') {
        let qr = sb.from('teams').select('slug,name,tag,logo_url,games(name)').order('created_at', { ascending: false }).range(offset, offset + PAGE - 1);
        if (game) qr = qr.eq('game_id', game);
        rows = await q(qr); card = teamCard; none = ['No teams yet', 'Be the first to create one.', 'teams.html?new=1', 'Create a team'];
      } else if (tab === 'communities') {
        let qr = sb.from('community_directory').select('slug,name,logo_url,member_count,game_name').order('member_count', { ascending: false }).range(offset, offset + PAGE - 1);
        if (game) qr = qr.eq('game_id', game);
        if (ctry) qr = qr.eq('country', ctry);
        rows = await q(qr); card = commCard; none = ['No communities yet', 'Be the first to create one.', 'communities.html?new=1', 'Create a community'];
      } else {
        rows = await q(sb.from('games').select('slug,name,cover_url').eq('is_active', true).order('sort_order').range(offset, offset + PAGE - 1));
        card = gameCard; none = ['No games yet', 'Games are added by NXT admins.'];
      }
      if (reset) root.innerHTML = '';
      if (!rows.length && offset === 0) { root.innerHTML = empty(...none); return; }
      let grid = root.querySelector('.nxt-grid');
      if (!grid) { root.innerHTML = '<div class="nxt-grid"></div>'; grid = root.firstChild; }
      grid.insertAdjacentHTML('beforeend', rows.map(card).join(''));
      root.querySelector('[data-more]')?.remove();
      if (rows.length === PAGE) {
        root.insertAdjacentHTML('beforeend', '<div class="row" style="justify-content:center;margin-top:18px"><button class="button outline" data-more>Load more</button></div>');
        root.querySelector('[data-more]').addEventListener('click', () => { offset += PAGE; load(false); });
      }
    } catch (e) { failed(root, e, () => load(true)); }
  }

  async function search(term) {
    loading(root, 4);
    try {
      const r = await rpc('global_search', { _q: term, _per: 6 });
      const sections = [['Users', r.users, (u) => personCard(u)], ['Creators', r.creators, (c) => `<a class="pcard" href="profile.html?u=${esc(c.username)}">${avatar(c)}<div class="meta"><b>${esc(c.display_name)}</b><small>${esc(c.category || 'Creator')}</small></div></a>`],
        ['Teams', r.teams, teamCard], ['Communities', r.communities, commCard], ['Games', r.games, gameCard],
        ['Tournaments', r.tournaments, (t) => `<a class="pcard" href="tournament.html?id=${Number(t.id)}"><span class="av av-md" aria-hidden="true">🏆</span><div class="meta"><b>${esc(t.name)}</b><small>${esc(t.game || '')} · ${esc(t.status)}</small></div></a>`]];
      const html = sections.filter(([, rows]) => rows && rows.length).map(([title, rows, card]) => `<h2 class="section-title">${title}</h2><div class="nxt-grid">${rows.map(card).join('')}</div>`).join('');
      root.innerHTML = html || empty(`No results for “${term}”`, 'Check the spelling or try a game or gamertag.');
    } catch (e) { failed(root, e, () => search(term)); }
  }

  function renderTabs() {
    tabsEl.innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === tab}" data-t="${k}">${l}</button>`).join('');
    tabsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      tab = b.dataset.t; filters.dataset.game = ''; filters.dataset.country = '';
      history.replaceState(null, '', `?tab=${tab}`);
      renderTabs(); await renderFilters(); load(true);
    }));
  }

  qInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = qInput.value.trim();
      const on = v.length >= 2;
      tabsEl.hidden = filters.hidden = on;
      if (on) search(v); else load(true);
    }, 250);
  });
  document.getElementById('search-form').addEventListener('submit', (e) => e.preventDefault());

  setMeta('Discover creators, gamers, teams & communities — NXT', 'Find South African gamers, creators, teams, communities and games on NXT.');
  const initial = param('q');
  renderTabs();
  renderFilters().then(() => { if (initial && initial.length >= 2) { qInput.value = initial; qInput.dispatchEvent(new Event('input')); } else load(true); });
})();
