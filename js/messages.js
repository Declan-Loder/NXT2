/* Private messaging: direct conversations, message requests, block, report, read receipts. */
(function () {
  const { esc, q, rpc, sb, avatar, empty, loading, failed, act, confirmDialog, report, timeAgo, toast, param, requireAuth } = NXT;
  const root = document.getElementById('app');
  let me, convs = [], current = null, channel;

  async function init() {
    const s = await requireAuth(root, 'Sign in to send and receive messages.');
    if (!s) return;
    me = s.user.id;
    root.innerHTML = `<div class="pagehead"><div><div class="kicker">Inbox</div><h1>Messages</h1></div></div><div class="msgs" id="msgs" data-open="0"><div class="list" id="list" aria-label="Conversations"></div><section class="thread" id="thread" aria-label="Conversation"></section></div>`;
    await loadList();
    const to = param('to'), c = param('c');
    if (c && convs.find((x) => x.conversation_id === c)) open(convs.find((x) => x.conversation_id === c));
    else if (to) {
      const ex = convs.find((x) => x.other_id === to);
      if (ex) open(ex); else await compose(to);
    } else document.getElementById('thread').innerHTML = empty('Select a conversation', 'Or visit a profile and press Message to start one.', 'discover.html', 'Find people');
  }

  async function loadList() {
    const list = document.getElementById('list');
    try {
      convs = await rpc('list_conversations');
      const reqs = convs.filter((c) => c.status === 'pending' && c.created_by !== me);
      const rest = convs.filter((c) => !reqs.includes(c));
      const row = (c) => `<button class="conv" type="button" data-c="${c.conversation_id}" ${current?.conversation_id === c.conversation_id ? 'aria-current="true"' : ''}>${avatar({ avatar_url: c.other_avatar_url, display_name: c.other_display_name || c.other_username })}<span class="t"><b>${esc(c.other_display_name || c.other_username)}</b><small>${esc(c.last_body || '')}</small></span>${c.unread_count > 0 ? `<span class="n" aria-label="${c.unread_count} unread">${c.unread_count}</span>` : ''}</button>`;
      list.innerHTML = (reqs.length ? `<h2 class="section-title" style="padding:12px 14px 0;margin:0">Message requests</h2>${reqs.map(row).join('')}<h2 class="section-title" style="padding:12px 14px 0;margin:0">Conversations</h2>` : '') + (rest.map(row).join('') || (reqs.length ? '' : '<p class="muted" style="padding:16px">No conversations yet.</p>'));
      list.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => open(convs.find((x) => x.conversation_id === b.dataset.c))));
    } catch (e) { failed(list, e, loadList); }
  }

  async function compose(toId) {
    const th = document.getElementById('thread');
    document.getElementById('msgs').dataset.open = '1';
    try {
      const [p] = await q(sb.from('profiles').select('id,username,display_name,avatar_url').eq('id', toId).limit(1));
      if (!p) { th.innerHTML = empty('User not found', ''); return; }
      current = { conversation_id: null, other_id: p.id, other_username: p.username, other_display_name: p.display_name, other_avatar_url: p.avatar_url, status: 'new', created_by: me };
      paintThread([]);
    } catch (e) { failed(th, e, () => compose(toId)); }
  }

  async function open(c) {
    if (!c) return;
    current = c;
    document.getElementById('msgs').dataset.open = '1';
    document.querySelectorAll('.conv').forEach((b) => b.toggleAttribute('aria-current', b.dataset.c === c.conversation_id));
    const th = document.getElementById('thread');
    loading(th, 2);
    try {
      const msgs = await q(sb.from('messages').select('id,sender_id,body,created_at').eq('conversation_id', c.conversation_id).order('created_at', { ascending: true }).limit(300));
      const parts = await q(sb.from('conversation_participants').select('user_id,last_read_at').eq('conversation_id', c.conversation_id));
      current.otherRead = parts.find((p) => p.user_id !== me)?.last_read_at;
      paintThread(msgs);
      if (c.unread_count > 0) { rpc('mark_conversation_read', { _cid: c.conversation_id }).then(loadList).catch(() => {}); c.unread_count = 0; }
      if (channel) sb.removeChannel(channel);
      channel = sb.channel('conv-' + c.conversation_id).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${c.conversation_id}` }, () => open(current)).subscribe();
    } catch (e) { failed(th, e, () => open(c)); }
  }

  function paintThread(msgs) {
    const c = current, th = document.getElementById('thread');
    const isRequestForMe = c.status === 'pending' && c.created_by !== me;
    const lastMine = [...msgs].reverse().find((m) => m.sender_id === me);
    th.innerHTML = `<header><div class="row"><button class="button outline btn-sm" id="back" type="button" aria-label="Back to conversations">←</button><a class="row" href="profile.html?id=${esc(c.other_id)}">${avatar({ avatar_url: c.other_avatar_url, display_name: c.other_display_name || c.other_username }, 'sm')}<b>${esc(c.other_display_name || c.other_username)}</b></a></div><span class="row"><button class="button outline btn-sm" id="rep" type="button">Report</button><button class="button danger btn-sm" id="blk" type="button">Block</button></span></header>
      ${isRequestForMe ? `<div class="panel row between" style="margin:12px"><span>Message request from @${esc(c.other_username)}. Replying accepts it.</span><span class="row"><button class="button btn-sm" data-r="1" type="button">Accept</button><button class="button outline btn-sm" data-r="0" type="button">Decline</button></span></div>` : ''}
      ${c.status === 'pending' && c.created_by === me ? '<p class="muted-sm" style="padding:8px 16px 0;margin:0">Your message request is pending. You can send more once they accept.</p>' : ''}
      <div class="log" id="log" role="log" aria-live="polite">${msgs.length ? msgs.map((m) => `<div class="bub${m.sender_id === me ? ' me' : ''}">${esc(m.body)}<small>${timeAgo(m.created_at)}${m === lastMine && c.otherRead && new Date(c.otherRead) >= new Date(m.created_at) ? ' · Read' : ''}${m.sender_id !== me ? `<button type="button" data-rm="${m.id}">Report</button>` : ''}</small></div>`).join('') : '<p class="muted">Say hello 👋</p>'}</div>
      <form id="send"><label class="sr-only" for="body">Message</label><textarea id="body" rows="1" maxlength="2000" required placeholder="Write a message"></textarea><button class="button" type="submit">Send</button></form>`;
    const log = document.getElementById('log'); log.scrollTop = log.scrollHeight;
    document.getElementById('back').addEventListener('click', () => { document.getElementById('msgs').dataset.open = '0'; });
    document.getElementById('rep').addEventListener('click', () => report('user', c.other_id));
    th.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => report('message', b.dataset.rm)));
    document.getElementById('blk').addEventListener('click', async () => { if (await confirmDialog(`Block @${c.other_username}? You won’t receive messages from them.`, 'Block')) { const r = await act(null, () => rpc('block_user', { _target: c.other_id }), 'User blocked.'); if (r !== undefined) { current = null; init(); } } });
    th.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', async () => { const r = await act(b, () => rpc('respond_message_request', { _cid: c.conversation_id, _accept: b.dataset.r === '1' }), b.dataset.r === '1' ? 'Request accepted.' : 'Request declined.'); if (r !== undefined) { await loadList(); if (b.dataset.r === '1') { c.status = 'accepted'; open(c); } else { document.getElementById('thread').innerHTML = ''; document.getElementById('msgs').dataset.open = '0'; } } }));
    const body = document.getElementById('body');
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); document.getElementById('send').requestSubmit(); } });
    document.getElementById('send').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = body.value;
      const r = await act(e.submitter, () => rpc('send_message', { _to: c.other_id, _body: text }));
      if (r === undefined) return;
      body.value = '';
      await loadList();
      const fresh = convs.find((x) => x.other_id === c.other_id);
      if (fresh) open(fresh);
    });
  }
  init();
})();
