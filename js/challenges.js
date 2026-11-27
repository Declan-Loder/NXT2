/* Ranked 1v1 matches: challenge → accept → schedule → submit result → confirm / dispute. */
(function () {
  const { esc, q, rpc, sb, session, avatar, empty, loading, failed, gameOptions, games, act, ask, confirmDialog, when, toast, param, requireAuth, ilikeEscape } = NXT;
  const root = document.getElementById('app');
  let me, gmap = {}, pmap = {};

  const STATUS = { pending: ['Awaiting reply', ''], accepted: ['Accepted', 'lime'], awaiting_confirmation: ['Awaiting confirmation', 'warn'], disputed: ['Disputed', 'bad'], completed: ['Completed', 'lime'], declined: ['Declined', ''], cancelled: ['Cancelled', ''] };
  const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

  async function init() {
    const s = await requireAuth(root, 'Sign in to challenge players and track ranked results.');
    if (!s) return;
    me = s.user.id;
    root.innerHTML = `<div class="pagehead"><div><div class="kicker">Compete</div><h1>Matches</h1><p>Challenge a player, play, then both confirm the score. Confirmed results update rankings and XP.</p></div></div>
      <form class="panel stack" id="new" style="margin-bottom:26px"><h2 style="margin:0">New challenge</h2>
        <div class="form-row"><div class="form-group"><label for="n-user">Opponent username</label><input id="n-user" required maxlength="20" autocomplete="off" placeholder="username"></div><div class="form-group"><label for="n-game">Game</label><select id="n-game" required></select></div></div>
        <div class="form-row"><div class="form-group"><label for="n-when">Proposed time (optional)</label><input id="n-when" type="datetime-local"></div><div class="form-group"><label for="n-msg">Message (optional)</label><input id="n-msg" maxlength="300"></div></div>
        <div><button class="button" type="submit">Send challenge</button></div></form>
      <div id="lists" aria-live="polite"></div>`;
    document.getElementById('n-game').innerHTML = await gameOptions('', 'Choose a game');
    const vs = param('vs');
    if (vs) { try { const [p] = await q(sb.from('profiles').select('username').eq('id', vs).limit(1)); if (p) document.getElementById('n-user').value = p.username; } catch { /* ignore */ } }
    document.getElementById('new').addEventListener('submit', onCreate);
    (await games()).forEach((g) => (gmap[g.id] = g));
    refresh();
  }

  async function onCreate(e) {
    e.preventDefault();
    const name = document.getElementById('n-user').value.trim();
    const res = await act(e.submitter, async () => {
      const [opp] = await q(sb.from('profiles').select('id').ilike('username', ilikeEscape(name)).limit(1));
      if (!opp) throw new Error('No player with that username.');
      const w = document.getElementById('n-when').value;
      return rpc('create_challenge', { _opponent: opp.id, _game: document.getElementById('n-game').value, _message: document.getElementById('n-msg').value || null, _scheduled: w ? new Date(w).toISOString() : null });
    }, 'Challenge sent!');
    if (res) { e.target.reset(); refresh(); }
  }

  async function refresh() {
    const box = document.getElementById('lists');
    loading(box, 3);
    try {
      const rows = await q(sb.from('challenges').select('*').order('updated_at', { ascending: false }).limit(60));
      const ids = [...new Set(rows.flatMap((r) => [r.challenger_id, r.opponent_id]))];
      if (ids.length) (await q(sb.from('profiles').select('id,username,display_name,avatar_url').in('id', ids))).forEach((p) => (pmap[p.id] = p));
      const incoming = rows.filter((r) => r.status === 'pending' && r.opponent_id === me);
      const active = rows.filter((r) => ['pending', 'accepted', 'awaiting_confirmation', 'disputed'].includes(r.status) && !incoming.includes(r));
      const done = rows.filter((r) => ['completed', 'declined', 'cancelled'].includes(r.status));
      const sec = (t, a, none) => `<h2 class="section-title">${t}</h2>${a.length ? `<div class="stack">${a.map(card).join('')}</div>` : `<p class="muted">${none}</p>`}`;
      box.innerHTML = sec('Challenges for you', incoming, 'No incoming challenges.') + sec('Active matches', active, 'No active matches. Send a challenge above.') + sec('History', done, 'No finished matches yet.');
      box.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => onAction(b)));
    } catch (e) { failed(box, e, refresh); }
  }

  function card(c) {
    const mineIsChallenger = c.challenger_id === me;
    const a = pmap[c.challenger_id] || {}, b = pmap[c.opponent_id] || {};
    const [label, tone] = STATUS[c.status] || [c.status, ''];
    const scored = c.challenger_score != null;
    const btn = (act2, text, cls = '') => `<button class="button ${cls} btn-sm" data-a="${act2}" data-id="${c.id}" type="button">${text}</button>`;
    let actions = '';
    if (c.status === 'pending') actions = mineIsChallenger ? btn('cancel', 'Cancel', 'outline') : btn('accept', 'Accept') + btn('decline', 'Decline', 'outline');
    if (c.status === 'accepted') actions = btn('result', 'Submit result') + btn('schedule', 'Set time', 'outline') + btn('cancel', 'Cancel', 'outline');
    if (c.status === 'awaiting_confirmation') actions = c.reported_by === me ? '<span class="muted-sm">Waiting for your opponent to confirm.</span>' : btn('confirm', 'Confirm result') + btn('dispute', 'Dispute', 'danger');
    if (c.status === 'disputed') actions = '<span class="muted-sm">A moderator is reviewing this result.</span>';
    return `<article class="mcard"><div class="row between"><span class="chip ${tone}">${label}</span><span class="muted-sm">${esc(gmap[c.game_id]?.name || 'Game')}${c.scheduled_at ? ' · ' + when(c.scheduled_at) : ''}</span></div>
      <div class="vs"><a class="row" href="profile.html?id=${esc(a.id)}">${avatar(a, 'sm')}${esc(a.display_name || a.username || 'Player')}</a>${scored ? `<span class="score">${c.challenger_score} – ${c.opponent_score}</span>` : '<span class="muted-sm">vs</span>'}<a class="row" href="profile.html?id=${esc(b.id)}">${avatar(b, 'sm')}${esc(b.display_name || b.username || 'Player')}</a></div>
      ${c.message ? `<div class="muted-sm">“${esc(c.message)}”</div>` : ''}${c.status === 'completed' && !c.rated ? '<div class="muted-sm">Did not count towards rankings (daily limit).</div>' : ''}${c.evidence_url && /^https:\/\//.test(c.evidence_url) ? `<a class="muted-sm" href="${esc(c.evidence_url)}" target="_blank" rel="noopener noreferrer nofollow">Evidence ↗</a>` : ''}
      ${actions ? `<div class="row">${actions}</div>` : ''}</article>`;
  }

  async function onAction(b) {
    const id = b.dataset.id, kind = b.dataset.a;
    const row = { accept: () => rpc('respond_challenge', { _id: id, _accept: true }), decline: () => rpc('respond_challenge', { _id: id, _accept: false }), cancel: null, confirm: () => rpc('confirm_result', { _id: id }) }[kind];
    let fn = row, ok = 'Done.';
    if (kind === 'cancel') { if (!(await confirmDialog('Cancel this match?', 'Cancel match'))) return; fn = () => rpc('cancel_challenge', { _id: id }); }
    if (kind === 'confirm') { if (!(await confirmDialog('Confirm this score? Rankings and XP update immediately and cannot be undone.', 'Confirm', false))) return; ok = 'Result confirmed. Rankings updated.'; }
    if (kind === 'schedule') { const v = await ask({ title: 'Set match time', submit: 'Save', fields: [{ name: 'w', label: 'Date and time', type: 'datetime-local', required: true }] }); if (!v) return; fn = () => rpc('schedule_challenge', { _id: id, _scheduled: new Date(v.w).toISOString() }); }
    if (kind === 'result') { const v = await ask({ title: 'Submit result', submit: 'Submit', fields: [{ name: 'mine', label: 'Your score', type: 'number', required: true }, { name: 'theirs', label: 'Opponent’s score', type: 'number', required: true }, { name: 'ev', label: 'Evidence link (https://, optional)', type: 'url' }] }); if (!v) return; fn = () => rpc('report_result', { _id: id, _my_score: Number(v.mine), _opp_score: Number(v.theirs), _evidence: v.ev || null }); ok = 'Result submitted. Your opponent must confirm it.'; }
    if (kind === 'dispute') { const v = await ask({ title: 'Dispute this result', submit: 'Send dispute', danger: true, fields: [{ name: 'r', label: 'What is wrong with the score?', type: 'textarea', required: true, max: 500 }] }); if (!v) return; fn = () => rpc('dispute_result', { _id: id, _reason: v.r }); ok = 'Dispute sent to moderators.'; }
    const r = await act(b, fn, ok);
    if (r !== undefined) refresh();
  }
  init();
})();
