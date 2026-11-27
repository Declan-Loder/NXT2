/* Game pages — fully database-driven (games table). */
(function () {
  const { esc, q, rpc, sb, avatar, empty, loading, failed, safeUrl, when, setMeta, param } = NXT;
  const root = document.getElementById('app');
  const slug = param('slug');

  async function list() {
    setMeta('Games — NXT', 'Every game supported on NXT with players, tournaments, communities and leaderboards.');
    root.innerHTML = '<div class="pagehead"><div><div class="kicker">Play</div><h1>Games</h1></div></div><div id="g"></div>';
    const g = document.getElementById('g'); loading(g, 3);
    try {
      const rows = await q(sb.from('games').select('slug,name,cover_url,publisher').eq('is_active', true).order('sort_order'));
      g.innerHTML = rows.length ? `<div class="nxt-grid">${rows.map((r) => `<a class="pcard" href="games.html?slug=${esc(r.slug)}">${avatar({ name: r.name, avatar_url: r.cover_url })}<div class="meta"><b>${esc(r.name)}</b><small>${esc(r.publisher || '')}</small></div></a>`).join('')}</div>` : empty('No games yet', 'Games are added by NXT admins.');
    } catch (e) { failed(g, e, list); }
  }

  async function detail() {
    loading(root, 3);
    try {
      const [game] = await q(sb.from('games').select('id,slug,name,publisher,cover_url').eq('slug', slug).eq('is_active', true).limit(1));
      if (!game) { root.innerHTML = empty('Game not found', '', 'games.html', 'All games'); return; }
      setMeta(`${game.name} — players, tournaments & leaderboards | NXT`, `Tournaments, communities, creators and rankings for ${game.name} on NXT.`);
      const [board, tours, comms, teams, creators, recent] = await Promise.all([
        rpc('leaderboard', { _game: game.id, _limit: 10 }).catch(() => []),
        q(sb.from('tournaments').select('id,name,status,starts_at,entry_fee').eq('game_id', game.id).in('status', ['open', 'live', 'closed', 'completed']).order('starts_at', { ascending: false }).limit(6)).catch(() => []),
        q(sb.from('community_directory').select('slug,name,logo_url,member_count').eq('game_id', game.id).order('member_count', { ascending: false }).limit(6)).catch(() => []),
        q(sb.from('teams').select('slug,name,tag,logo_url').eq('game_id', game.id).limit(6)).catch(() => []),
        q(sb.from('creator_profiles').select('slug,display_name,avatar_url,category').ilike('category', `%${NXT.ilikeEscape(game.name)}%`).limit(6)).catch(() => []),
        q(sb.from('player_stats').select('played').eq('game_id', game.id).limit(1000)).catch(() => []),
      ]);
      const sec = (t, html, none) => `<h2 class="section-title">${t}</h2>${html || `<p class="muted">${none}</p>`}`;
      root.innerHTML = `<div class="pagehead"><div><div class="kicker">${esc(game.publisher || 'Game')}</div><h1>${esc(game.name)}</h1><p>${board.length ? `${recent.length}${recent.length === 1000 ? '+' : ''} ranked players` : 'No ranked players yet'}</p></div><a class="button" href="challenges.html">Play a ranked match</a></div>
        <div class="cols"><div>
          ${sec('Leaderboard', board.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th>W</th><th>Rating</th></tr></thead><tbody>${board.map((r) => `<tr><td class="rk">${r.rank}</td><td><a class="who" href="profile.html?id=${esc(r.user_id)}">${avatar(r, 'sm')}${esc(r.display_name || r.username)}</a></td><td>${r.wins}</td><td><b>${r.score}</b></td></tr>`).join('')}</tbody></table></div><p style="margin-top:10px"><a href="leaderboards.html?tab=game&game=${esc(game.id)}">Full leaderboard →</a></p>` : '', 'No rankings yet. Be the first.')}
          ${sec('Tournaments', tours.length ? `<div class="stack">${tours.map((t) => `<a class="pcard" href="tournament.html?id=${Number(t.id)}"><span class="av av-md" aria-hidden="true">🏆</span><div class="meta"><b>${esc(t.name)}</b><small>${esc(t.status)} · ${when(t.starts_at)}</small></div></a>`).join('')}</div>` : '', 'No tournaments for this game yet.')}
        </div><aside>
          ${sec('Communities', comms.length ? `<div class="stack">${comms.map((c) => `<a class="pcard" href="communities.html?slug=${esc(c.slug)}">${avatar(c)}<div class="meta"><b>${esc(c.name)}</b><small>${c.member_count} members</small></div></a>`).join('')}</div>` : '', 'None yet. <a href="communities.html?new=1">Start one</a>.')}
          ${sec('Teams', teams.length ? `<div class="stack">${teams.map((t) => `<a class="pcard" href="teams.html?slug=${esc(t.slug)}">${avatar(t)}<div class="meta"><b>${esc(t.name)}</b><small>${esc(t.tag || '')}</small></div></a>`).join('')}</div>` : '', 'No teams yet.')}
          ${sec('Creators', creators.length ? `<div class="stack">${creators.map((c) => `<div class="pcard">${avatar({ display_name: c.display_name, avatar_url: c.avatar_url })}<div class="meta"><b>${esc(c.display_name)}</b><small>${esc(c.category || '')}</small></div></div>`).join('')}</div>` : '', 'No creators tagged with this game yet.')}
        </aside></div>`;
    } catch (e) { failed(root, e, detail); }
  }
  slug ? detail() : list();
})();
