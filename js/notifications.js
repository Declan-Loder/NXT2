/* Notifications centre with unread/read state and realtime updates. */
(function () {
  const { esc, q, rpc, sb, session, empty, loading, failed, safeLink, timeAgo, act, requireAuth } = NXT;
  const root = document.getElementById('app');
  let filter = 'all', uid;
  const PAGE = 30;
  let rows = [];

  async function init() {
    const s = await requireAuth(root, 'Sign in to see your notifications.');
    if (!s) return;
    uid = s.user.id;
    root.innerHTML = `<div class="pagehead"><div><div class="kicker">Activity</div><h1>Notifications</h1></div><button class="button outline" id="all-read" type="button">Mark all as read</button></div>
      <div class="tabs" role="tablist" id="ftabs"><button role="tab" type="button" aria-selected="true" data-f="all">All</button><button role="tab" type="button" aria-selected="false" data-f="unread">Unread</button></div><div id="list" class="stack" aria-live="polite"></div>`;
    document.getElementById('ftabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; document.querySelectorAll('#ftabs button').forEach((x) => x.setAttribute('aria-selected', x === b)); load(true); }));
    document.getElementById('all-read').addEventListener('click', async (e) => { const r = await act(e.target, () => rpc('mark_all_notifications_read'), 'All caught up.'); if (r !== undefined) load(true); });
    sb.channel('notif-page-' + uid).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => load(true)).subscribe();
    load(true);
  }

  async function load(reset) {
    const list = document.getElementById('list');
    if (reset) { rows = []; loading(list, 4); }
    try {
      let qr = sb.from('notifications').select('id,type,title,body,link,read_at,created_at').order('created_at', { ascending: false }).range(rows.length, rows.length + PAGE - 1);
      if (filter === 'unread') qr = qr.is('read_at', null);
      const next = await q(qr);
      rows = rows.concat(next);
      if (!rows.length) { list.innerHTML = empty(filter === 'unread' ? 'You’re all caught up' : 'No notifications yet', filter === 'unread' ? 'Nothing new.' : 'Follow players, join communities and play matches to see activity here.', 'discover.html', 'Discover'); return; }
      list.innerHTML = rows.map((n) => `<div class="notif ${n.read_at ? 'read' : 'unread'}"><span class="dot" aria-hidden="true"></span><a href="${esc(safeLink(n.link))}" data-id="${n.id}"><b>${esc(n.title)}</b>${n.body ? `<span>${esc(n.body)}</span><br>` : ''}<small>${timeAgo(n.created_at)}${n.read_at ? '' : ' · unread'}</small></a><button class="button outline btn-sm" data-del="${n.id}" type="button" aria-label="Delete notification">✕</button></div>`).join('') + (next.length === PAGE ? '<div class="row" style="justify-content:center"><button class="button outline" data-more type="button">Load more</button></div>' : '');
      list.querySelectorAll('a[data-id]').forEach((a) => a.addEventListener('click', () => sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.dataset.id).is('read_at', null)));
      list.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { const r = await act(b, () => q(sb.from('notifications').delete().eq('id', b.dataset.del))); if (r !== undefined) load(true); }));
      list.querySelector('[data-more]')?.addEventListener('click', () => load(false));
    } catch (e) { failed(list, e, () => load(true)); }
  }
  init();
})();
