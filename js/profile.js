/* Public gamer / creator profile. */
(function () {
  const { esc, rpc, session, avatar, verified, empty, loading, failed, safeUrl, country, act, report, confirmDialog, toast, param, setMeta, timeAgo } = NXT;
  const root = document.getElementById('app');
  const SOCIALS = { twitch: 'Twitch', youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', x: 'X', discord: 'Discord', steam: 'Steam', website: 'Website' };
  const ROLE_LABEL = { player: 'Gamer', creator: 'Creator', team: 'Team', community: 'Community', business: 'Business', organiser: 'Organiser', moderator: 'Moderator', admin: 'Admin' };

  async function load() {
    loading(root, 3);
    try {
      const s = await session();
      let id = param('id'), u = param('u');
      if (!id && !u) { if (s) id = s.user.id; else { root.innerHTML = empty('Sign in to see your profile', 'Create an account to get a public gaming profile.', 'player-login.html', 'Sign in or register'); return; } }
      const p = await rpc('get_profile_summary', id ? { _id: id } : { _username: u });
      if (!p) { root.innerHTML = empty('Profile not found', 'This player may have changed their username or does not exist.', 'discover.html', 'Discover players'); return; }
      render(p, s);
    } catch (e) { failed(root, e, load); }
  }

  const statRow = (r) => `<tr><td>${esc(r.game)}</td><td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.played ? Math.round((100 * r.wins) / r.played) : 0}%</td><td>${r.rating}</td><td>${r.best_streak}</td></tr>`;

  function render(d, s) {
    const p = d.profile;
    const name = p.display_name || p.username;
    setMeta(`${name} (@${p.username}) — NXT`, p.bio || `${name} on NXT: stats, teams, communities and achievements.`, { '@context': 'https://schema.org', '@type': 'ProfilePage', mainEntity: { '@type': 'Person', name, alternateName: p.username, description: p.bio || undefined, image: safeUrl(p.avatar_url) || undefined, sameAs: Object.values(p.social_links || {}).filter((u) => safeUrl(u)) } });
    const roles = (d.roles || []).filter((r) => ROLE_LABEL[r]);
    const links = Object.entries(p.social_links || {}).filter(([k, v]) => SOCIALS[k] && safeUrl(v)).map(([k, v]) => `<a class="chip" href="${esc(safeUrl(v))}" target="_blank" rel="noopener noreferrer nofollow">${SOCIALS[k]}</a>`);
    (d.creator ? [['twitch_url', 'Twitch'], ['youtube_url', 'YouTube'], ['tiktok_url', 'TikTok'], ['instagram_url', 'Instagram']] : []).forEach(([k, l]) => {
      if (safeUrl(d.creator[k]) && !links.some((x) => x.includes('>' + l + '<'))) links.push(`<a class="chip" href="${esc(safeUrl(d.creator[k]))}" target="_blank" rel="noopener noreferrer nofollow">${l}</a>`);
    });
    const lvlBase = (d.level - 1) ** 2 * 100, lvlNext = d.level ** 2 * 100;
    const pct = Math.min(100, Math.round(((d.xp - lvlBase) / (lvlNext - lvlBase)) * 100));

    root.innerHTML = `
      <div class="pbanner">${safeUrl(p.banner_url) ? `<img src="${esc(safeUrl(p.banner_url))}" alt="">` : ''}</div>
      <div class="phead">${avatar({ ...p }, 'lg')}
        <div style="flex:1;min-width:200px"><h1>${esc(name)}${verified(p.is_verified)}</h1>
          <div class="muted-sm">@${esc(p.username)}${p.country ? ' · ' + esc(country(p.country)) : ''}${d.player?.gamertag ? ' · ' + esc(d.player.gamertag) + (d.player.primary_platform ? ' (' + esc(d.player.primary_platform) + ')' : '') : ''}</div>
          <div class="row" style="margin-top:8px">${roles.map((r) => `<span class="chip ${r === 'creator' ? 'lime' : ''}">${ROLE_LABEL[r]}${r === 'player' && d.stats.length ? ' • Competitive' : ''}</span>`).join('')}${d.creator?.category ? `<span class="chip">${esc(d.creator.category)}</span>` : ''}</div></div>
        <div class="row" id="actions"></div>
      </div>
      <div class="pstats"><div><b id="followers">${d.followers}</b><span>Followers</span></div><div><b>${d.following}</b><span>Following</span></div><div><b>${d.stats.reduce((a, r) => a + r.played, 0)}</b><span>Matches</span></div><div><b>${d.stats.reduce((a, r) => a + r.wins, 0)}</b><span>Wins</span></div><div><b>Lv ${d.level}</b><span>${d.xp} XP</span></div></div>
      <div class="cols" style="margin-top:26px"><div>
        ${p.bio ? `<p style="white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 6px">${esc(p.bio)}</p>` : ''}
        ${links.length ? `<div class="row" style="margin:12px 0">${links.join('')}</div>` : ''}
        <h2 class="section-title">Match statistics</h2>
        ${d.stats.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Game</th><th>Played</th><th>Wins</th><th>Losses</th><th>Win rate</th><th>Rating</th><th>Best streak</th></tr></thead><tbody>${d.stats.map(statRow).join('')}</tbody></table></div>`
          : empty('No ranked matches yet', d.is_me ? 'Challenge a friend and confirm the result to get on the board.' : 'Ranked matches appear here once a result is confirmed.', 'challenges.html', 'Play a ranked match')}
        <h2 class="section-title">Recent matches</h2>
        ${d.recent_matches.length ? `<div class="stack">${d.recent_matches.map((m) => `<div class="mcard"><div class="vs"><span>${esc(m.challenger_username)}</span><span class="score">${m.challenger_score} – ${m.opponent_score}</span><span>${esc(m.opponent_username)}</span></div><div class="muted-sm">${esc(m.game)} · ${timeAgo(m.completed_at)}</div></div>`).join('')}</div>` : '<p class="muted">Nothing here yet.</p>'}
      </div><aside>
        <h2 class="section-title" style="margin-top:0">Level ${d.level}</h2><div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to next level"><i style="width:${pct}%"></i></div><p class="muted-sm">${lvlNext - d.xp} XP to level ${d.level + 1}</p>
        <h2 class="section-title">Achievements</h2>
        ${d.achievements.length ? `<div class="stack">${d.achievements.map((a) => `<div class="ach"><span class="ic" aria-hidden="true">★</span><div><b>${esc(a.name)}</b><div class="muted-sm">${esc(a.description)}</div></div></div>`).join('')}</div>` : '<p class="muted">No achievements yet.</p>'}
        <h2 class="section-title">Teams</h2>
        ${d.teams.length ? `<div class="stack">${d.teams.map((t) => `<a class="pcard" href="teams.html?slug=${esc(t.slug)}">${avatar(t)}<div class="meta"><b>${esc(t.name)}</b><small>${t.tag ? '[' + esc(t.tag) + '] · ' : ''}${esc(t.role)}</small></div></a>`).join('')}</div>` : '<p class="muted">Not on a team.</p>'}
        <h2 class="section-title">Communities</h2>
        ${d.communities.length ? `<div class="stack">${d.communities.map((c) => `<a class="pcard" href="communities.html?slug=${esc(c.slug)}">${avatar(c)}<div class="meta"><b>${esc(c.name)}</b><small>${esc(c.role)}</small></div></a>`).join('')}</div>` : '<p class="muted">Not in any communities.</p>'}
      </aside></div>`;
    actions(d, s);
  }

  function actions(d, s) {
    const box = document.getElementById('actions');
    const p = d.profile;
    if (d.is_me) { box.innerHTML = '<a class="button outline" href="settings.html">Edit profile</a><a class="button outline" href="player-dashboard.html">Dashboard</a>'; return; }
    box.innerHTML = `<button class="button" id="follow" type="button" aria-pressed="${d.is_following}">${d.is_following ? 'Following' : 'Follow'}</button><a class="button outline" href="messages.html?to=${esc(p.id)}">Message</a><a class="button outline" href="challenges.html?vs=${esc(p.id)}">Challenge</a><button class="button outline" id="more" type="button" aria-haspopup="dialog">⋯</button>`;
    const fb = document.getElementById('follow');
    fb.addEventListener('click', async () => {
      if (!s) { location.href = 'player-login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search); return; }
      const on = fb.getAttribute('aria-pressed') !== 'true';
      const ok = await act(fb, () => rpc(on ? 'follow_user' : 'unfollow_user', { _target: p.id }), null);
      if (ok !== undefined) { fb.setAttribute('aria-pressed', on); fb.textContent = on ? 'Following' : 'Follow'; const f = document.getElementById('followers'); f.textContent = Number(f.textContent) + (on ? 1 : -1); }
    });
    document.getElementById('more').addEventListener('click', async () => {
      const v = await NXT.ask({ title: 'More actions', submit: 'Go', fields: [{ name: 'a', label: 'Action', type: 'select', options: [['report', 'Report this user'], ['block', 'Block this user']] }] });
      if (!v) return;
      if (v.a === 'report') return report('user', p.id);
      if (!s) { toast('Sign in first.'); return; }
      if (await confirmDialog(`Block @${p.username}? They won’t be able to message, follow or challenge you.`, 'Block')) {
        await act(null, () => rpc('block_user', { _target: p.id }), 'User blocked.'); load();
      }
    });
  }
  load();
})();
