/* Account settings: profile, account/password, privacy, notifications, security. */
(function () {
  const { esc, q, rpc, sb, session, avatar, empty, loading, failed, countryOptions, safeUrl, act, confirmDialog, uploadImage, requireAuth, toast, signOutEverywhere, friendly } = NXT;
  const root = document.getElementById('app');
  const SOC = ['twitch', 'youtube', 'tiktok', 'instagram', 'x', 'discord', 'steam', 'website'];
  let s, prof, set;
  const v = (id) => document.getElementById(id).value.trim();

  async function init() {
    s = await requireAuth(root, 'Sign in to manage your account.');
    if (!s) return;
    loading(root, 3);
    try {
      prof = await rpc('get_my_profile');
      const rows = await q(sb.from('user_settings').select('*').eq('user_id', s.user.id).limit(1));
      set = rows[0] || { dm_policy: 'everyone', notify_follows: true, notify_matches: true, notify_messages: true };
      shell(); show('profile');
    } catch (e) { failed(root, e, init); }
  }
  const TABS = [['profile', 'Profile'], ['account', 'Account'], ['privacy', 'Privacy'], ['notifications', 'Notifications'], ['security', 'Security']];
  function shell() {
    root.innerHTML = `<div class="pagehead"><div><div class="kicker">Your account</div><h1>Settings</h1></div><a class="button outline" href="profile.html?id=${esc(s.user.id)}">View public profile</a></div><div class="tabs" role="tablist" id="stabs"></div><div id="pane"></div>`;
  }
  function show(k) {
    document.getElementById('stabs').innerHTML = TABS.map(([t, l]) => `<button role="tab" type="button" aria-selected="${t === k}" data-t="${t}">${l}</button>`).join('');
    document.querySelectorAll('#stabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.t)));
    ({ profile, account, privacy, notifications, security })[k]();
  }
  const pane = () => document.getElementById('pane');

  function profile() {
    const soc = prof.social_links || {};
    pane().innerHTML = `<form class="panel stack" id="f"><div class="row">${avatar(prof, 'lg')}<div class="stack" style="flex:1;min-width:220px"><div class="form-group"><label for="p-av">Avatar (JPG/PNG/WebP, max 2 MB)</label><input id="p-av" type="file" accept="image/jpeg,image/png,image/webp"></div><div class="form-group"><label for="p-bn">Banner</label><input id="p-bn" type="file" accept="image/jpeg,image/png,image/webp"></div></div></div>
      <div class="form-row"><div class="form-group"><label for="p-name">Display name</label><input id="p-name" maxlength="40" value="${esc(prof.display_name || '')}"></div><div class="form-group"><label for="p-user">Username</label><input id="p-user" maxlength="20" pattern="[A-Za-z0-9_]{3,20}" value="${esc(prof.username || '')}"><small class="muted-sm">3–20 letters, numbers or underscores.</small></div></div>
      <div class="form-row"><div class="form-group"><label for="p-country">Country</label><select id="p-country">${countryOptions(prof.country || 'ZA')}</select></div><div class="form-group"><label for="p-discord">Discord username</label><input id="p-discord" maxlength="40" value="${esc(prof.discord_username || '')}"></div></div>
      <div class="form-group"><label for="p-bio">Bio</label><textarea id="p-bio" rows="3" maxlength="500">${esc(prof.bio || '')}</textarea></div>
      <h2 class="section-title" style="margin:4px 0">Social links (https:// only)</h2>
      <div class="form-row">${SOC.map((k) => `<div class="form-group"><label for="s-${k}">${k === 'x' ? 'X' : k[0].toUpperCase() + k.slice(1)}</label><input id="s-${k}" type="url" maxlength="200" placeholder="https://" value="${esc(soc[k] || '')}"></div>`).join('')}</div>
      <div><button class="button" type="submit">Save profile</button></div></form>`;
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      const links = {};
      for (const k of SOC) { const val = v('s-' + k); if (val) { if (!/^https:\/\//i.test(val)) { toast(`${k}: links must start with https://`); return; } links[k] = val; } }
      const r = await act(e.submitter, async () => {
        const upd = { display_name: v('p-name') || null, username: v('p-user') || null, country: v('p-country') || null, discord_username: v('p-discord') || null, bio: v('p-bio') || null, social_links: links };
        const a = document.getElementById('p-av').files[0], b = document.getElementById('p-bn').files[0];
        if (a) upd.avatar_url = await uploadImage(a, 'avatar');
        if (b) upd.banner_url = await uploadImage(b, 'banner');
        await q(sb.from('profiles').update(upd).eq('id', s.user.id));
      }, 'Profile saved.');
      if (r !== undefined) { prof = await rpc('get_my_profile'); profile(); }
    });
  }

  function account() {
    pane().innerHTML = `<div class="panel stack"><h2 style="margin:0">Email</h2><p style="margin:0">${esc(s.user.email)} ${s.user.email_confirmed_at ? '<span class="chip lime">Verified</span>' : '<span class="chip warn">Not verified</span>'}</p>
      ${s.user.email_confirmed_at ? '' : '<button class="button outline btn-sm" id="resend" type="button" style="justify-self:start">Resend verification email</button>'}</div>
      <form class="panel stack" id="pw" style="margin-top:14px"><h2 style="margin:0">Change password</h2><div class="form-group"><label for="pw1">New password (min. 8 characters)</label><input id="pw1" type="password" minlength="8" required autocomplete="new-password"></div><div class="form-group"><label for="pw2">Confirm new password</label><input id="pw2" type="password" minlength="8" required autocomplete="new-password"></div><div><button class="button" type="submit">Update password</button></div></form>`;
    document.getElementById('resend')?.addEventListener('click', (e) => act(e.target, async () => { const { error } = await sb.auth.resend({ type: 'signup', email: s.user.email }); if (error) throw error; }, 'Verification email sent.'));
    document.getElementById('pw').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (v('pw1') !== v('pw2')) { toast('Passwords do not match.'); return; }
      const r = await act(e.submitter, async () => { const { error } = await sb.auth.updateUser({ password: document.getElementById('pw1').value }); if (error) throw error; }, 'Password updated.');
      if (r !== undefined) e.target.reset();
    });
  }

  async function privacy() {
    pane().innerHTML = `<form class="panel stack" id="pv"><h2 style="margin:0">Who can message you?</h2><div class="form-group"><label for="dm" class="sr-only">Direct messages</label><select id="dm"><option value="everyone">Everyone (strangers go to message requests)</option><option value="following">Only people I follow</option><option value="nobody">Nobody</option></select></div><div><button class="button" type="submit">Save</button></div></form><h2 class="section-title">Blocked users</h2><div id="blocked"></div>`;
    document.getElementById('dm').value = set.dm_policy;
    document.getElementById('pv').addEventListener('submit', async (e) => { e.preventDefault(); const r = await act(e.submitter, () => saveSettings({ dm_policy: v('dm') }), 'Privacy saved.'); if (r !== undefined) set.dm_policy = v('dm'); });
    const box = document.getElementById('blocked');
    try {
      const rows = await q(sb.from('blocks').select('blocked_id'));
      if (!rows.length) { box.innerHTML = '<p class="muted">You haven’t blocked anyone.</p>'; return; }
      const ps = await q(sb.from('profiles').select('id,username,display_name,avatar_url').in('id', rows.map((r) => r.blocked_id)));
      box.innerHTML = `<div class="stack">${ps.map((p) => `<div class="pcard">${avatar(p)}<div class="meta"><b>${esc(p.display_name || p.username)}</b><small>@${esc(p.username)}</small></div><button class="button outline btn-sm" data-u="${p.id}" type="button" style="margin-left:auto">Unblock</button></div>`).join('')}</div>`;
      box.querySelectorAll('[data-u]').forEach((b) => b.addEventListener('click', async () => { const r = await act(b, () => rpc('unblock_user', { _target: b.dataset.u }), 'Unblocked.'); if (r !== undefined) privacy(); }));
    } catch (e) { failed(box, e, privacy); }
  }

  function notifications() {
    const T = [['notify_follows', 'New followers'], ['notify_matches', 'Match challenges and results'], ['notify_messages', 'Messages and requests']];
    pane().innerHTML = `<form class="panel stack" id="nf"><h2 style="margin:0">Notify me about</h2>${T.map(([k, l]) => `<label class="row"><input type="checkbox" id="${k}" style="width:auto" ${set[k] ? 'checked' : ''}> ${l}</label>`).join('')}<div><button class="button" type="submit">Save</button></div></form><p class="muted-sm">Team invitations, achievements and moderation notices are always delivered.</p>`;
    document.getElementById('nf').addEventListener('submit', async (e) => { e.preventDefault(); const patch = Object.fromEntries(T.map(([k]) => [k, document.getElementById(k).checked])); const r = await act(e.submitter, () => saveSettings(patch), 'Notification settings saved.'); if (r !== undefined) Object.assign(set, patch); });
  }

  async function saveSettings(patch) {
    await q(sb.from('user_settings').upsert({ user_id: s.user.id, ...patch, updated_at: new Date().toISOString() }));
  }

  function security() {
    pane().innerHTML = `<div class="panel stack"><h2 style="margin:0">Sessions</h2><p class="muted" style="margin:0">Signed in as ${esc(s.user.email)}. Signing out everywhere ends every session on every device.</p><div class="row"><button class="button outline" id="so" type="button">Sign out</button><button class="button danger" id="soa" type="button">Sign out everywhere</button></div></div>
      <div class="panel" style="margin-top:14px"><h2 style="margin-top:0">Two-factor authentication</h2><p class="muted" style="margin:0">Not available yet. It requires enabling MFA in your Supabase project and is on the roadmap.</p></div>`;
    document.getElementById('so').addEventListener('click', async () => { await sb.auth.signOut(); location.href = 'index.html'; });
    document.getElementById('soa').addEventListener('click', async () => { if (await confirmDialog('Sign out of all devices?', 'Sign out everywhere', false)) signOutEverywhere(); });
  }
  init();
})();
