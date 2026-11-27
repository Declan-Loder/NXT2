/* Leaderboards: overall (XP), per game (rating), country, community, team, tournament standings. */
(function () {
  const { esc, q, rpc, sb, avatar, verified, empty, loading, failed, countryOptions, gameOptions, setMeta, param } = NXT;
  const root = document.getElementById('results'), filters = document.getElementById('filters'), tabsEl = document.getElementById('tabs');
  const TABS = [['overall', 'Overall'], ['game', 'By game'], ['country', 'Country'], ['community', 'Community'], ['team', 'Team'], ['tournament', 'Tournament']];
  let tab = TABS.some((t) => t[0] === param('tab')) ? param('tab') : 'overall';
  let offset = 0;
  const PAGE = 50;

  async function renderFilters() {
    let html = '';
    if (tab === 'game' || tab === 'country') html += `<select id="f-game" aria-label="Game">${await gameOptions(param('game') || '', tab === 'game' ? null : 'All games')}</select>`;
    if (tab === 'country') html += `<select id="f-country" aria-label="Country">${countryOptions('ZA')}</select>`;
    if (tab === 'community') {
      const rows = await q(sb.from('community_directory').select('id,name').order('member_count', { ascending: false }).limit(100)).catch(() => []);
      html += `<select id="f-community" aria-label="Community">${rows.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('') || '<option value="">No communities</option>'}</select>`;
    }
    if (tab === 'team') {
      const rows = await q(sb.from('teams').select('id,name').order('name').limit(100)).catch(() => []);
      html += `<select id="f-team" aria-label="Team">${rows.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('') || '<option value="">No teams</option>'}</select>`;
    }
    if (tab === 'tournament') {
      const rows = await q(sb.from('tournaments').select('id,name').in('status', ['open', 'live', 'closed', 'completed']).order('created_at', { ascending: false }).limit(50)).catch(() => []);
      html += `<select id="f-tournament" aria-label="Tournament">${rows.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('') || '<option value="">No tournaments</option>'}</select>`;
    }
    filters.innerHTML = html;
    filters.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => load(true)));
  }

  const val = (id) => filters.querySelector('#' + id)?.value || null;
  const scoreLabel = () => (tab === 'overall' ? 'XP' : 'Rating');

  async function load(reset) {
    if (reset) { offset = 0; loading(root, 5); }
    try {
      if (tab === 'tournament') return tournament();
      const gameId = tab === 'game' ? val('f-game') : tab === 'country' ? val('f-game') : null;
      const args = { _game: gameId, _country: tab === 'country' ? val('f-country') : null, _community: tab === 'community' ? val('f-community') : null, _team: tab === 'team' ? val('f-team') : null, _limit: PAGE, _offset: offset };
      if ((tab === 'community' && !args._community) || (tab === 'team' && !args._team)) { root.innerHTML = empty(`No ${tab === 'team' ? 'teams' : 'communities'} yet`, 'Be the first to create one.', tab === 'team' ? 'teams.html?new=1' : 'communities.html?new=1', 'Create one'); return; }
      const label = gameId ? 'Rating' : 'XP';
      const rows = await rpc('leaderboard', args);
      if (reset || !root.querySelector('tbody')) {
        if (!rows.length) { root.innerHTML = empty('No rankings yet', 'Rankings appear after the first confirmed ranked match.', 'challenges.html', 'Play a ranked match'); return; }
        root.innerHTML = `<div class="tbl-wrap"><table class="tbl"><caption class="sr-only">Leaderboard</caption><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Played</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Win %</th><th scope="col">${label}</th></tr></thead><tbody></tbody></table></div>`;
      }
      root.querySelector('tbody').insertAdjacentHTML('beforeend', rows.map((r) => `<tr><td class="rk">${r.rank}</td><td><a class="who" href="profile.html?id=${esc(r.user_id)}">${avatar(r, 'sm')}<span>${esc(r.display_name || r.username)}${verified(r.is_verified)}</span></a></td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.win_rate}%</td><td><b>${r.score}</b></td></tr>`).join(''));
      root.querySelector('[data-more]')?.remove();
      if (rows.length === PAGE) { root.insertAdjacentHTML('beforeend', '<div class="row" style="justify-content:center;margin-top:16px"><button class="button outline" data-more>Load more</button></div>'); root.querySelector('[data-more]').addEventListener('click', () => { offset += PAGE; load(false); }); }
    } catch (e) { failed(root, e, () => load(true)); }
  }

  async function tournament() {
    const id = val('f-tournament');
    if (!id) { root.innerHTML = empty('No tournaments yet', 'Standings appear once a tournament has results.', 'tournaments.html', 'Browse tournaments'); return; }
    const rows = await q(sb.from('tournament_standings').select('player_name,wins,losses,draws,points,rank').eq('tournament_id', id).order('points', { ascending: false }).order('wins', { ascending: false }));
    root.innerHTML = rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">Pts</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td class="rk">${i + 1}</td><td>${esc(r.player_name)}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td><b>${r.points}</b></td></tr>`).join('')}</tbody></table></div>` : empty('No standings yet', 'Results will show here once matches are played.');
  }

  function renderTabs() {
    tabsEl.innerHTML = TABS.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === tab}" data-t="${k}">${l}</button>`).join('');
    tabsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => { tab = b.dataset.t; history.replaceState(null, '', `?tab=${tab}`); renderTabs(); await renderFilters(); load(true); }));
  }
  setMeta('Leaderboards — NXT', 'Overall, game, country, community and team rankings for South African gamers.');
  renderTabs(); renderFilters().then(() => load(true));
})();
