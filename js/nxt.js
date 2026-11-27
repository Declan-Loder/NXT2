/* NXT platform core. Loaded after app.js (reuses its Supabase client). */
(function () {
  'use strict';
  const sb = typeof supabaseClient !== 'undefined' ? supabaseClient : null;
  const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m) => (typeof notice === 'function' ? notice(m) : console.info(m));

  const COUNTRIES = { ZA: 'South Africa', NA: 'Namibia', BW: 'Botswana', ZW: 'Zimbabwe', MZ: 'Mozambique', LS: 'Lesotho', SZ: 'Eswatini', ZM: 'Zambia', MW: 'Malawi', AO: 'Angola', KE: 'Kenya', NG: 'Nigeria', GH: 'Ghana', EG: 'Egypt', MA: 'Morocco', GB: 'United Kingdom', IE: 'Ireland', US: 'United States', CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', DE: 'Germany', FR: 'France', ES: 'Spain', PT: 'Portugal', NL: 'Netherlands', IT: 'Italy', BR: 'Brazil', IN: 'India', AE: 'United Arab Emirates' };

  /** Turn a Supabase/PostgREST error into a sentence a person can act on. */
  function friendly(err) {
    const m = String((err && (err.message || err.error_description)) || err || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Network problem. Check your connection and try again.';
    if (/JWT|not authenticated|Sign in required/i.test(m)) return 'Please sign in to continue.';
    if (/permission denied|row-level security/i.test(m)) return 'You do not have permission to do that.';
    if (/duplicate key|unique/i.test(m)) return 'That value is already taken.';
    return m.replace(/^ERROR:\s*/i, '') || 'Something went wrong. Please try again.';
  }

  async function rpc(fn, args) {
    if (!sb) throw new Error('The app is not connected to Supabase.');
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(friendly(error));
    return data;
  }
  /** Unwrap a supabase-js query result or throw a friendly error. */
  async function q(promise) {
    const { data, error, count } = await promise;
    if (error) throw new Error(friendly(error));
    return count != null ? { data, count } : data;
  }

  let sessionCache;
  async function session() {
    if (!sb) return null;
    if (sessionCache === undefined) {
      const { data } = await sb.auth.getSession();
      sessionCache = data.session || null;
      sb.auth.onAuthStateChange((_e, s) => { sessionCache = s || null; });
    }
    return sessionCache;
  }
  async function requireAuth(root, why) {
    const s = await session();
    if (s) return s;
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    if (root) root.innerHTML = empty('Sign in to continue', why || 'You need an account for this.', `player-login.html?next=${next}`, 'Sign in or register');
    return null;
  }

  const safeUrl = (u) => (/^https:\/\/[^\s]{1,500}$/i.test(String(u || '')) ? String(u) : '');
  const safeLink = (l) => (/^[a-z0-9-]+\.html(\?[\w=&%.-]*)?$/i.test(String(l || '')) ? String(l) : '#');
  const param = (k) => new URLSearchParams(location.search).get(k);
  const ilikeEscape = (s) => String(s).replace(/[\\%_,()]/g, ' ').trim();
  const country = (c) => COUNTRIES[c] || c || '';
  const countryOptions = (sel, any) => (any ? `<option value="">${esc(any)}</option>` : '') + Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

  function timeAgo(ts) {
    const s = Math.max(1, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
    if (s < 60) return 'just now';
    const steps = [[60, 'm'], [3600, 'h'], [86400, 'd'], [604800, 'w']];
    for (let i = steps.length - 1; i >= 0; i--) if (s >= steps[i][0]) return `${Math.floor(s / steps[i][0])}${steps[i][1]} ago`;
    return '';
  }
  const when = (ts) => (ts ? new Date(ts).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA');

  const avatar = (p, size = 'md') => {
    const name = (p && (p.display_name || p.username || p.name)) || '?';
    const url = safeUrl(p && (p.avatar_url || p.logo_url));
    return url ? `<img class="av av-${size}" src="${esc(url)}" alt="" loading="lazy" width="48" height="48">`
               : `<span class="av av-${size}" aria-hidden="true">${esc(name.trim().charAt(0).toUpperCase() || '?')}</span>`;
  };
  const verified = (on) => (on ? '<span class="vbadge" title="Verified" role="img" aria-label="Verified">✓</span>' : '');
  const empty = (title, text, href, cta) => `<div class="nxt-empty"><h3>${esc(title)}</h3><p>${esc(text || '')}</p>${href ? `<a class="button" href="${esc(href)}">${esc(cta || 'Continue')}</a>` : ''}</div>`;
  const loading = (el, n = 3) => { if (el) el.innerHTML = Array.from({ length: n }, () => '<div class="skel" aria-hidden="true"></div>').join('') + '<span class="sr-only" role="status">Loading…</span>'; };
  const failed = (el, err, retry) => {
    if (!el) return;
    el.innerHTML = `<div class="nxt-error" role="alert">${esc(friendly(err))} ${retry ? '<button class="button outline btn-sm" type="button" data-retry>Try again</button>' : ''}</div>`;
    const b = el.querySelector('[data-retry]'); if (b) b.addEventListener('click', retry);
  };

  /** Run an async action on a button: disables it, reports errors via toast. */
  async function act(btn, fn, okMsg) {
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(friendly(e)); return undefined; }
    finally { if (btn) btn.disabled = false; }
  }

  /** Accessible modal built on <dialog>. fields: [{name,label,type,options,required,max}] */
  function ask({ title, fields, submit = 'Submit', danger = false }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'nxt-dialog';
      d.setAttribute('aria-labelledby', 'dlg-t');
      const inputs = fields.map((f) => {
        const id = 'f-' + f.name;
        const ctl = f.type === 'select' ? `<select id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`
          : f.type === 'textarea' ? `<textarea id="${id}" name="${f.name}" rows="3" maxlength="${f.max || 500}" ${f.required ? 'required' : ''}></textarea>`
          : `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" maxlength="${f.max || 200}" ${f.required ? 'required' : ''}>`;
        return `<div class="form-group"><label for="${id}">${esc(f.label)}</label>${ctl}</div>`;
      }).join('');
      d.innerHTML = `<form method="dialog"><h3 id="dlg-t">${esc(title)}</h3>${inputs}<div class="row"><button type="button" class="button outline" data-x>Cancel</button><button class="button${danger ? ' danger' : ''}" value="ok">${esc(submit)}</button></div></form>`;
      document.body.appendChild(d);
      const done = (v) => { d.close(); d.remove(); resolve(v); };
      d.querySelector('[data-x]').addEventListener('click', () => done(null));
      d.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
      d.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(Object.fromEntries(new FormData(e.target).entries())); });
      d.showModal();
      const first = d.querySelector('input,select,textarea'); if (first) first.focus();
    });
  }
  const confirmDialog = async (title, submit = 'Confirm', danger = true) => (await ask({ title, fields: [], submit, danger })) !== null;

  const REASONS = [['harassment', 'Harassment'], ['spam', 'Spam'], ['scamming', 'Scamming'], ['cheating', 'Cheating'], ['impersonation', 'Impersonation'], ['inappropriate_content', 'Inappropriate content'], ['other', 'Other']];
  async function report(type, id) {
    if (!(await session())) { toast('Sign in to report.'); return; }
    const v = await ask({ title: 'Report', submit: 'Send report', fields: [
      { name: 'reason', label: 'Reason', type: 'select', options: REASONS },
      { name: 'details', label: 'Details (optional)', type: 'textarea', max: 1000 }] });
    if (!v) return;
    try { await rpc('submit_report', { _type: type, _target: String(id), _reason: v.reason, _details: v.details || null }); toast('Report sent. Thank you.'); }
    catch (e) { toast(friendly(e)); }
  }

  let gamesPromise;
  const games = () => (gamesPromise ||= q(sb.from('games').select('id,slug,name,short_name,cover_url').eq('is_active', true).order('sort_order')).catch(() => []));
  const gameOptions = async (sel, any) => (any ? `<option value="">${esc(any)}</option>` : '') + (await games()).map((g) => `<option value="${g.id}"${g.id === sel ? ' selected' : ''}>${esc(g.name)}</option>`).join('');

  /** Upload to the public `media` bucket under the user's own folder. Returns the public URL. */
  async function uploadImage(file, kind) {
    const s = await session();
    if (!s) throw new Error('Sign in to upload.');
    if (!file) throw new Error('Choose an image.');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
    if (!ext) throw new Error('Use a JPG, PNG or WebP image.');
    if (file.size > 2 * 1024 * 1024) throw new Error('Images must be 2 MB or smaller.');
    const path = `${s.user.id}/${kind}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from('media').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(friendly(error));
    return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
  }

  function setMeta(title, desc, jsonLd) {
    document.title = title;
    // canonical + Open Graph/Twitter follow the rendered entity (crawlers that execute JS see these)
    const canon = location.origin + location.pathname + (location.search.match(/^\?(?:id|slug|u)=[^&]+/) || [''])[0];
    const set = (sel, attr, val, mk) => { let e = document.querySelector(sel); if (!e) { e = document.createElement(mk.tag); Object.entries(mk.attrs).forEach(([k, x]) => e.setAttribute(k, x)); document.head.appendChild(e); } e.setAttribute(attr, val); };
    set('link[rel="canonical"]', 'href', canon, { tag: 'link', attrs: { rel: 'canonical' } });
    set('meta[property="og:title"]', 'content', title, { tag: 'meta', attrs: { property: 'og:title' } });
    set('meta[property="og:description"]', 'content', (desc || '').slice(0, 200), { tag: 'meta', attrs: { property: 'og:description' } });
    set('meta[property="og:url"]', 'content', canon, { tag: 'meta', attrs: { property: 'og:url' } });
    set('meta[name="twitter:title"]', 'content', title, { tag: 'meta', attrs: { name: 'twitter:title' } });
    if (jsonLd) {
      let j = document.getElementById('jsonld');
      if (!j) { j = document.createElement('script'); j.type = 'application/ld+json'; j.id = 'jsonld'; document.head.appendChild(j); }
      j.textContent = JSON.stringify(jsonLd).replace(/</g, '\\u003c');
    }
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    if (desc) m.content = desc.slice(0, 160);
  }

  /* ---------------- shell for new pages ---------------- */
  const NAV = [['index.html', 'Home'], ['tournaments.html', 'Tournaments'], ['discover.html', 'Discover'], ['leaderboards.html', 'Leaderboards'], ['communities.html', 'Communities'], ['creators.html', 'Creators'], ['shop.html', 'Shop']];
  const MORE = [['teams.html', 'Teams'], ['games.html', 'Games'], ['challenges.html', 'Matches'], ['about.html', 'About'], ['sponsors.html', 'Partnerships']];
  const link = ([h, l], close) => `<a href="${h}"${close ? ' onclick="closeMenu()"' : ''}>${l}</a>`;
  function injectShell() {
    const h = document.getElementById('site-header');
    if (h) h.outerHTML = `<a class="skip-link" href="#app">Skip to content</a><header class="nav"><a class="brand" href="index.html">NXT<span>.</span></a><nav class="links" aria-label="Main">${NAV.map((n) => link(n)).join('')}</nav><div class="navright"><a class="button outline" href="player-login.html">Login</a><a class="button" href="player-login.html">Register</a><button class="hamburger" onclick="toggleMenu()" aria-label="Menu"><span></span><span></span><span></span></button></div></header><div class="mobile-menu" id="mobile-menu">${[...NAV, ...MORE].map((n) => link(n, true)).join('')}<a href="player-login.html" onclick="closeMenu()">Login / Register</a></div>`;
    const f = document.getElementById('site-footer');
    if (f) f.outerHTML = `<footer class="footer" style="margin-top:40px"><span>© 2026 NXT · South Africa</span><span><a href="privacy.html">Privacy</a> · <a href="terms.html">Terms</a> · <a href="contact.html">Contact</a></span></footer>`;
  }

  /* ---------------- auth-aware nav, bell, tab bar ---------------- */
  const ICON = {
    home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  };
  async function enhanceNav() {
    const s = await session();
    const page = location.pathname.split('/').pop() || 'index.html';
    const tabs = [['index.html', 'Home', 'home'], ['discover.html', 'Discover', 'search'], ['tournaments.html', 'Tournaments', 'trophy'], ['challenges.html', 'Matches', 'bolt'], [s ? `profile.html?id=${s.user.id}` : 'player-login.html', s ? 'Profile' : 'Sign in', 'user']];
    if (!document.querySelector('.tabbar')) {
      const nav = document.createElement('nav');
      nav.className = 'tabbar'; nav.setAttribute('aria-label', 'App');
      nav.innerHTML = tabs.map(([h, l, i]) => `<a href="${h}"${h.split('?')[0] === page ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[i]}</svg><span>${l}</span></a>`).join('');
      document.body.appendChild(nav);
    }
    if (!s) return;

    const right = document.querySelector('.navright');
    if (right) {
      right.querySelectorAll('a.button[href="player-login.html"]').forEach((a) => a.remove());
      const bell = document.createElement('a');
      bell.className = 'bell'; bell.href = 'notifications.html'; bell.setAttribute('aria-label', 'Notifications');
      bell.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/></svg><i hidden></i>';
      const me = document.createElement('a');
      me.className = 'button outline'; me.href = `profile.html?id=${s.user.id}`; me.textContent = 'Profile';
      const ham = right.querySelector('.hamburger');
      right.insertBefore(me, ham); right.insertBefore(bell, me);
      refreshBadge(bell.querySelector('i'));
      if (sb.channel) {
        sb.channel('nav-notif-' + s.user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${s.user.id}` }, () => refreshBadge(bell.querySelector('i'))).subscribe();
      }
    }
    const mm = document.getElementById('mobile-menu');
    if (mm) {
      const li = [...mm.querySelectorAll('a')].find((a) => /player-login/.test(a.getAttribute('href') || ''));
      const extra = [['notifications.html', 'Notifications'], ['messages.html', 'Messages'], ['challenges.html', 'Matches'], ['settings.html', 'Settings'], ['player-dashboard.html', 'Dashboard']];
      const html = extra.map(([h, l]) => `<a href="${h}" onclick="closeMenu()">${l}</a>`).join('') + '<a href="#" data-signout onclick="closeMenu()">Sign out</a>';
      if (li) li.outerHTML = html; else mm.insertAdjacentHTML('beforeend', html);
      mm.querySelector('[data-signout]')?.addEventListener('click', async (e) => { e.preventDefault(); await sb.auth.signOut(); location.href = 'index.html'; });
    }
    try {
      const roles = await q(sb.from('user_roles').select('role').eq('user_id', s.user.id));
      if (roles.some((r) => ['moderator', 'admin', 'superadmin'].includes(r.role))) {
        right?.insertBefore(Object.assign(document.createElement('a'), { className: 'button outline', href: 'admin.html', textContent: 'Admin' }), right.querySelector('.bell'));
        mm?.insertAdjacentHTML('beforeend', '<a href="admin.html" onclick="closeMenu()">Admin</a>');
      }
    } catch { /* roles are optional UI sugar */ }
  }
  async function refreshBadge(el) {
    if (!el) return;
    try {
      const { count } = await q(sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null));
      el.hidden = !count; el.textContent = count > 99 ? '99+' : String(count || '');
    } catch { el.hidden = true; }
  }

  async function signOutEverywhere() { await sb.auth.signOut({ scope: 'global' }); location.href = 'index.html'; }

  window.NXT = { sb, esc, toast, friendly, rpc, q, session, requireAuth, safeUrl, safeLink, param, ilikeEscape, country, countryOptions, COUNTRIES, timeAgo, when, avatar, verified, empty, loading, failed, act, ask, confirmDialog, report, games, gameOptions, uploadImage, setMeta, signOutEverywhere, injectShell };

  injectShell();
  document.addEventListener('DOMContentLoaded', () => {
    const cur = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.links a,.mobile-menu a').forEach((a) => a.getAttribute('href') === cur && a.classList.add('active'));
    if (sb) enhanceNav();
  });
})();
