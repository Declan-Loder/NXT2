/* NXT community website — shared frontend behaviours */

const SUPABASE_URL = 'https://sagmjbyrtdindecmeyil.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gDsserZ9EnBRPNpuawZ08Q_Byy6MEfO';

const supabaseClient =
  typeof window.supabase !== 'undefined' && window.supabase.createClient
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const CART_KEY = 'nxt_cart';

function getCart() {
  try {
    const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {}
  updateCartUI();
}

function addToCart(id, name, price) {
  const cart = getCart();
  const found = cart.find((i) => i.id === id);
  if (found) found.qty++;
  else cart.push({ id, name, price: Number(price), qty: 1 });
  saveCart(cart);
  notice(`${name} added to cart`);
}

function changeQty(id, delta) {
  let cart = getCart();
  const item = cart.find((i) => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter((i) => i.id !== id);
  saveCart(cart);
}

function removeFromCart(id) {
  saveCart(getCart().filter((i) => i.id !== id));
}

function cartTotal() {
  return getCart().reduce(
    (sum, i) => sum + (Number(i.price) || 0) * (Number(i.qty) || 0),
    0
  );
}

function updateCartUI() {
  const cart = getCart();
  const count = cart.reduce((s, i) => s + i.qty, 0);

  document.querySelectorAll('.cart-count').forEach((el) => {
    el.textContent = count;
    el.style.display = count ? 'flex' : 'none';
  });

  const body = document.getElementById('cart-body');
  if (body) {
    body.innerHTML = cart.length
      ? cart
          .map(
            (i) => `
      <div class="cart-item">
        <div class="cart-item-art">NXT</div>
        <div class="cart-item-info">
          <h4>${escapeHtml(i.name)}</h4>
          <div style="font-size:13px;color:var(--muted)">R ${(Number(i.price) || 0).toFixed(2)}</div>
          <div class="cart-qty">
            <button aria-label="Decrease quantity" onclick="changeQty('${safeJs(i.id)}',-1)">−</button>
            <span>${i.qty}</span>
            <button aria-label="Increase quantity" onclick="changeQty('${safeJs(i.id)}',1)">+</button>
            <button onclick="removeFromCart('${safeJs(i.id)}')" style="margin-left:auto">Remove</button>
          </div>
        </div>
      </div>`
          )
          .join('')
      : '<div class="empty-cart">Your cart is empty.<br>Go grab some NXT gear.</div>';
  }

  const total = document.getElementById('cart-total-value');
  if (total) total.textContent = 'R ' + cartTotal().toFixed(2);
  updateCheckoutSummary();
}

function updateCheckoutSummary() {
  const summary = document.getElementById('checkout-items-summary');
  const total = document.getElementById('checkout-total');
  if (!summary || !total) return;

  const cart = getCart();
  summary.innerHTML = cart.length
    ? cart
        .map(
          (i) =>
            `${i.qty}× ${escapeHtml(i.name)} — R ${(i.price * i.qty).toFixed(2)}`
        )
        .join('<br>')
    : 'Your cart is empty.';
  total.textContent = 'R ' + cartTotal().toFixed(2);
}

function openCart() {
  document.getElementById('cart-overlay')?.classList.add('open');
  document.getElementById('cart-drawer')?.classList.add('open');
  updateCartUI();
}

function closeCart() {
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.getElementById('cart-drawer')?.classList.remove('open');
}

let toastTimer;
function notice(msg) {
  const t = document.getElementById('toast');
  if (!t) {
    console.info(msg);
    return;
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function toggleMenu() {
  document.querySelector('.hamburger')?.classList.toggle('open');
  document.getElementById('mobile-menu')?.classList.toggle('open');
  document.body.style.overflow = document
    .getElementById('mobile-menu')
    ?.classList.contains('open')
    ? 'hidden'
    : '';
}

function closeMenu() {
  document.querySelector('.hamburger')?.classList.remove('open');
  document.getElementById('mobile-menu')?.classList.remove('open');
  document.body.style.overflow = '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&',
        '<': '<',
        '>': '>',
        '"': '"',
        "'": '&#39;',
      })[c]
  );
}

function safeJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// =====================================================
// PAYSTACK (server-side initialize + verify)
// Secret key never leaves Vercel. Shop stays Coming Soon.
// =====================================================
const SHOP_PAYMENTS_LIVE = false; // flip to true when merch drop goes live

async function startPaystackPayment({ type, email, amount, metadata, callbackPath }) {
  const origin = location.origin;
  const callback_url =
    origin +
    (callbackPath || '/tournaments.html') +
    (String(callbackPath || '').includes('?') ? '&' : '?') +
    'payment=verify';

  const res = await fetch('/api/paystack-initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      email,
      amount,
      metadata,
      callback_url,
    }),
  });

  let payload = {};
  try {
    payload = await res.json();
  } catch {
    payload = {};
  }

  if (!res.ok || !payload.authorization_url) {
    throw new Error(payload.error || 'Could not start Paystack payment.');
  }

  // Keep pending tournament details for post-verify client insert fallback
  if (type === 'tournament' && metadata) {
    try {
      sessionStorage.setItem(
        'nxt_pending_registration',
        JSON.stringify({ ...metadata, email, amount, reference: payload.reference })
      );
    } catch {}
  }

  location.href = payload.authorization_url;
}

async function handlePaystackCheckout(e) {
  e.preventDefault();
  if (!SHOP_PAYMENTS_LIVE) {
    notice('NXT Supply is still Coming Soon. Checkout unlocks with the first drop.');
    return false;
  }
  if (!getCart().length) {
    notice('Your cart is empty. Add some items first.');
    return false;
  }

  const form = e.target;
  const btn = form.querySelector('[type="submit"]');
  const email = form.querySelector('[name="email"]')?.value?.trim();
  const name = form.querySelector('[name="name"]')?.value?.trim();
  const phone = form.querySelector('[name="phone"]')?.value?.trim();
  const address = form.querySelector('[name="address"]')?.value?.trim();
  const notes = form.querySelector('[name="notes"]')?.value?.trim() || '';

  if (!email || !name || !phone || !address) {
    notice('Please fill in all required fields.');
    return false;
  }

  const cart = getCart();
  const amount = cartTotal();
  if (btn) btn.disabled = true;

  try {
    await startPaystackPayment({
      type: 'shop',
      email,
      amount,
      metadata: {
        customer_name: name,
        phone,
        address,
        notes,
        items: cart.map((i) => `${i.qty}x ${i.name}`).join(', '),
        cart_total: amount,
      },
      callbackPath: '/checkout.html',
    });
  } catch (err) {
    notice(err.message || 'Payment could not start.');
    if (btn) btn.disabled = false;
  }
  return false;
}

// Backwards-compatible name used by checkout.html
function handlePayFastCheckout(e) {
  return handlePaystackCheckout(e);
}

async function checkPaymentReturn() {
  const params = new URLSearchParams(location.search);
  const payment = params.get('payment');
  const reference = params.get('reference') || params.get('trxref');

  // Clean URL once we start handling
  if (payment || reference) {
    const clean = new URLSearchParams(params);
    clean.delete('payment');
    clean.delete('reference');
    clean.delete('trxref');
    history.replaceState(
      {},
      '',
      location.pathname + (clean.toString() ? '?' + clean : '')
    );
  }

  if (!reference && payment !== 'verify') return;

  const ref = reference;
  if (!ref) {
    if (payment === 'cancelled') notice('Payment was cancelled.');
    return;
  }

  notice('Verifying payment…');

  try {
    const res = await fetch('/api/paystack-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: ref }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Verification failed.');

    if (!payload.paid) {
      notice(payload.message || 'Payment was not successful.');
      return;
    }

    // Shop success
    if (payload.metadata?.nxt_type === 'shop') {
      saveCart([]);
      notice('Payment successful! We will confirm your order by email.');
      return;
    }

    // Tournament: server confirmed registration
    if (payload.registration) {
      try {
        sessionStorage.removeItem('nxt_pending_registration');
      } catch {}
      notice('Payment successful — you are registered!');
      if (typeof showCheckoutPanel === 'function') {
        showCheckoutPanel({
          registration: {
            ...payload.registration,
            payment_status: 'paid',
            payment_method: payload.registration.payment_method || 'card',
            payment_amount:
              payload.registration.payment_amount ?? payload.amount ?? 0,
          },
        });
      }
      loadTournaments?.();
      return;
    }

    // Client-side fallback insert if service role not configured
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem('nxt_pending_registration') || 'null');
    } catch {
      pending = null;
    }

    if (pending && supabaseClient) {
      const { error } = await supabaseClient.from('registrations').insert({
        tournament_id: Number(pending.tournament_id),
        player_name: String(pending.player_name || '').trim(),
        gamertag: String(pending.gamertag || '').trim(),
        platform: pending.platform || 'PC',
        email: pending.email || payload.email,
        payment_reference: ref,
        payment_status: 'paid',
        amount_paid: payload.amount,
      });
      if (error) {
        // Columns may not exist yet — try minimal insert
        const { error: err2 } = await supabaseClient.from('registrations').insert({
          tournament_id: Number(pending.tournament_id),
          player_name: String(pending.player_name || '').trim(),
          gamertag: String(pending.gamertag || '').trim(),
          platform: pending.platform || 'PC',
        });
        if (err2) throw err2;
      }
      try {
        sessionStorage.removeItem('nxt_pending_registration');
      } catch {}
      notice('Payment successful — you are registered!');
      loadTournaments?.();
      return;
    }

    notice('Payment successful!');
  } catch (err) {
    notice(err.message || 'Could not verify payment.');
  }
}

function initRevealAnimations() {
  const els = document.querySelectorAll(
    '.hero,.stats,.section,.card,.featurebox,.product-card,.banner,.page-hero,.group-card,.sponsor-card,.form-card,.event-card'
  );
  els.forEach((el, i) => {
    el.classList.add('reveal');
    if (
      el.matches(
        '.card,.featurebox,.product-card,.group-card,.sponsor-card,.event-card'
      )
    ) {
      el.style.setProperty('--reveal-delay', `${(i % 4) * 75}ms`);
    }
  });

  if (!('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('is-visible'));
    return;
  }

  const obs = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add('is-visible');
          obs.unobserve(en.target);
        }
      }),
    { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }
  );
  els.forEach((e) => obs.observe(e));
}

// =====================================================
// CREATOR PROFILES — edit this object to add creators
// =====================================================
const NXT_CREATORS = {
  'teazers-0': {
    name: 'Teazers_0',
    role: 'Founder · Streamer · Community Builder',
    image: 'nxt-founder.webp',
    bio: 'A South African creator building a place where streamers, gamers and brands can grow together. Expect FC, community challenges, live moments and the work behind NXT.',
    games: ['EA SPORTS FC', 'Variety gaming', 'Community events'],
    twitch: 'https://www.twitch.tv/teazers_0',
  },
  'man0-xs': {
    name: 'Man0_xs',
    role: 'Founder · Gamer · Creator',
    image: 'founder2.webp',
    bio: 'A dedicated gamer and founder inspired by Fortnite, football games and Mortal Kombat. Focused on building communities where competition meets creativity.',
    games: ['Fortnite', 'EA SPORTS FC', 'Mortal Kombat'],
    twitch: 'https://twitch.tv/man0_xs',
  },
  'demi-diablo': {
    name: 'Demi_Diablo',
    role: 'Founder · Gamer · Creator',
    image: 'Founder3.webp',
    bio: 'A founder and creator driven by competitive gaming and community. Inspired by Fortnite, football games and Mortal Kombat, Demi_Diablo helps shape NXT as a home where competition meets creativity.',
    games: ['Fortnite', 'EA SPORTS FC', 'Mortal Kombat'],
    twitch: 'https://twitch.tv/demi_diablo',
  },
};

function initCreatorProfileLinks() {
  document.querySelectorAll('.featurebox').forEach((card) => {
    const h = card.querySelector('h3');
    if (!h || card.querySelector('.creator-profile-link')) return;

    const slug = h.textContent
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const a = document.createElement('a');
    a.className = 'button creator-profile-link';
    a.href = `creator.html?id=${encodeURIComponent(slug)}`;
    a.textContent = 'View creator profile ↗';

    const actions = card.querySelector('div[style*="display:flex"]');
    (actions || card).appendChild(a);
  });
}

function renderCreatorProfile() {
  const root = document.getElementById('creator-profile');
  if (!root) return;

  const c = NXT_CREATORS[new URLSearchParams(location.search).get('id')];
  if (!c) {
    root.innerHTML = `
      <div class="empty-state">
        <h2>Creator not found</h2>
        <p>This profile may have moved or is not public yet.</p>
        <a class="button" href="creators.html">Back to creators</a>
      </div>`;
    return;
  }

  root.innerHTML = `
    <div class="creator-profile-hero">
      <div class="creator-profile-image">
        <img src="${c.image}" alt="${escapeHtml(c.name)}">
      </div>
      <div>
        <div class="eyebrow">OFFICIAL NXT CREATOR</div>
        <h1>${escapeHtml(c.name)}</h1>
        <p class="creator-role">${c.role}</p>
        <p class="lead">${c.bio}</p>
        <div class="creator-tags">
          ${c.games.map((g) => `<span>${g}</span>`).join('')}
        </div>
        <div class="actions">
          <a class="button" href="${c.twitch}" target="_blank" rel="noopener noreferrer">Watch on Twitch ↗</a>
          <a class="button outline" href="collab.html">Propose a collab</a>
        </div>
      </div>
    </div>`;
}

async function initCreatorAuth() {
  const form = document.getElementById('creator-auth-form');
  if (!form) return;

  const status = document.getElementById('auth-status');
  if (!supabaseClient) {
    status.textContent =
      'Supabase is not connected. Add your real project URL and public anon key in app.js to enable sign-in.';
    return;
  }

  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    if (session) status.textContent = `Signed in as ${session.user.email}.`;
  } catch (e) {
    status.textContent = 'Unable to check your session. Please refresh.';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('[name="email"]').value.trim();
    const password = form.querySelector('[name="password"]').value;
    const action = form.querySelector('[name="auth_action"]').value;
    const btn = form.querySelector('[type="submit"]');

    btn.disabled = true;
    status.textContent = 'Please wait…';

    try {
      const result =
        action === 'signup'
          ? await supabaseClient.auth.signUp({ email, password })
          : await supabaseClient.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      if (result.data.session) {
        status.textContent =
          action === 'signup'
            ? 'Account created. Taking you to your dashboard…'
            : 'Signed in successfully.';
        setTimeout(() => (location.href = 'creator-dashboard.html'), 450);
      } else {
        status.textContent =
          action === 'signup'
            ? 'Account created. Check your email if verification is enabled, then sign in.'
            : 'Signed in successfully.';
      }
    } catch (err) {
      status.textContent = err.message || 'Unable to authenticate. Please try again.';
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('auth-switch')?.addEventListener('click', () => {
    const signup = form.querySelector('[name="auth_action"]').value !== 'signup';
    form.querySelector('[name="auth_action"]').value = signup ? 'signup' : 'login';
    form.querySelector('[type="submit"]').textContent = signup
      ? 'Create creator account'
      : 'Sign in';
    document.getElementById('auth-switch').textContent = signup
      ? 'Already have an account? Sign in'
      : 'New to NXT? Create an account';
    document.getElementById('auth-title').textContent = signup
      ? 'Join the creator network'
      : 'Welcome back';
  });
}

async function initCreatorDashboard() {
  const root = document.getElementById('creator-dashboard');
  if (!root) return;

  if (!supabaseClient) {
    root.innerHTML = `
      <div class="dashboard-shell">
        <div class="dashboard-header">
          <div>
            <div class="eyebrow">NXT CREATOR PORTAL</div>
            <h1>Setup required</h1>
            <p class="muted">Connect the correct Supabase project URL and public anon key in app.js to enable accounts.</p>
          </div>
          <a class="button outline" href="creator-login.html">Back to login</a>
        </div>
      </div>`;
    return;
  }

  try {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      location.replace('creator-login.html');
      return;
    }

    const user = session.user;
    const email = user.email || '—';
    const created = user.created_at
      ? new Date(user.created_at).toLocaleDateString('en-ZA', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })
      : '—';
    const lastSignIn = user.last_sign_in_at
      ? new Date(user.last_sign_in_at).toLocaleString('en-ZA', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'Just now';
    const confirmed = user.email_confirmed_at ? 'Verified' : 'Pending verification';
    const userId = user.id ? `${user.id.slice(0, 8)}…` : '—';

    root.innerHTML = `
      <div class="dashboard-shell">
        <div class="dashboard-header">
          <div>
            <div class="eyebrow">NXT CREATOR PORTAL</div>
            <h1>Welcome back.</h1>
            <p class="muted">Signed in as <strong>${escapeHtml(email)}</strong></p>
          </div>
          <div class="dashboard-actions">
            <a class="button outline" href="creators.html">Creator roster</a>
            <a class="button outline" href="collab.html">Open collab board</a>
            <button class="button" type="button" id="creator-signout">Sign out</button>
          </div>
        </div>

        <div class="dashboard-grid">
          <section class="dashboard-card">
            <h3>Account overview</h3>
            <p class="muted">Your private creator session. Public profile publishing unlocks once creator tables are live in Supabase.</p>
            <ul class="profile-list">
              <li><span>Email</span><strong>${escapeHtml(email)}</strong></li>
              <li><span>Status</span><strong>${escapeHtml(confirmed)}</strong></li>
              <li><span>Member since</span><strong>${escapeHtml(created)}</strong></li>
              <li><span>Last sign-in</span><strong>${escapeHtml(lastSignIn)}</strong></li>
              <li><span>Account ID</span><strong>${escapeHtml(userId)}</strong></li>
            </ul>
            <div class="dashboard-note">
              Profile editing, display name, social links and analytics need a <code>creator_profiles</code> table with RLS. Auth + session are already working.
            </div>
          </section>

          <section class="dashboard-card">
            <h3>Quick moves</h3>
            <p class="muted">Jump into the community while your profile tools come online.</p>
            <div class="dashboard-actions" style="flex-direction:column;align-items:stretch">
              <a class="button" href="https://discord.gg/Bxsw3Aam2" target="_blank" rel="noreferrer">Join Discord ↗</a>
              <a class="button outline" href="tournaments.html">Browse tournaments</a>
              <a class="button outline" href="shop.html">NXT Supply (coming soon)</a>
              <a class="button outline" href="sponsors.html">Brand partnerships</a>
            </div>
            <div class="dashboard-stats" style="margin-top:20px">
              <div class="dash-stat"><b>—</b><span>Collabs</span></div>
              <div class="dash-stat"><b>—</b><span>Events</span></div>
              <div class="dash-stat"><b>Live</b><span>Session</span></div>
            </div>
          </section>
        </div>
      </div>`;

    document.getElementById('creator-signout')?.addEventListener('click', async () => {
      try {
        await supabaseClient.auth.signOut();
      } finally {
        location.href = 'creator-login.html';
      }
    });
  } catch (e) {
    root.innerHTML = `
      <div class="dashboard-shell">
        <div class="dashboard-header">
          <div>
            <div class="eyebrow">NXT CREATOR PORTAL</div>
            <h1>Could not load session</h1>
            <p class="muted">Please refresh. If this keeps happening, check Supabase Auth URL config and anon key.</p>
          </div>
          <a class="button" href="creator-login.html">Back to login</a>
        </div>
      </div>`;
  }
}

function renderTournaments() {
  if (typeof tournamentTitle !== 'undefined') {
    const e = document.getElementById('tournament-title');
    if (e) e.textContent = tournamentTitle;
  }
  if (typeof tournamentSubtitle !== 'undefined') {
    const e = document.getElementById('tournament-subtitle');
    if (e) e.textContent = tournamentSubtitle;
  }

  const root = document.getElementById('groups-container');
  if (root && typeof groups !== 'undefined') {
    root.innerHTML = Object.entries(groups)
      .map(
        ([group, players]) => `
      <section class="group-card">
        <h3>Group ${group}</h3>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Player</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
              </tr>
            </thead>
            <tbody>
              ${players
                .map(
                  (p) => `
                <tr>
                  <td>${p.pos}</td>
                  <td>${escapeHtml(p.player)}</td>
                  <td>${p.p}</td>
                  <td>${p.w}</td>
                  <td>${p.d}</td>
                  <td>${p.l}</td>
                  <td>${p.gd}</td>
                  <td><strong>${p.pts}</strong></td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>`
      )
      .join('');
  }
}

async function loadTournaments() {
  const container = document.getElementById('live-tournaments');
  if (!container) return;

  if (!supabaseClient) {
    container.innerHTML =
      '<p class="muted">Live tournament listings will appear here when the Supabase connection is configured.</p>';
    return;
  }

  try {
    // Prefer status-based open/live listings; fall back to legacy `active` column
    let data = null;
    let error = null;

    ({ data, error } = await supabaseClient
      .from('tournaments')
      .select('*')
      .in('status', ['open', 'live'])
      .order('created_at', { ascending: false }));

    if (error) {
      const legacy = await supabaseClient
        .from('tournaments')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: false });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) throw error;

    if (!data?.length) {
      container.innerHTML =
        '<p class="muted">No live tournaments right now. Check back soon.</p>';
      return;
    }

    container.innerHTML = data
      .map((t) => {
        const fee = Number(t.entry_fee) || 0;
        const feeLabel = fee >= 1 ? `R ${fee.toFixed(0)} ENTRY` : 'FREE ENTRY';
        const btnLabel = fee >= 1 ? `Register · R ${fee.toFixed(0)} ↗` : 'Register free ↗';
        const dateRaw = t.starts_at || t.event_date;
        const dateLabel = dateRaw
          ? new Date(dateRaw).toLocaleDateString('en-ZA')
          : 'Date TBA';
        return `
      <article class="event-card">
        <div class="event-status">OPEN · ${feeLabel}</div>
        <h3>${escapeHtml(t.name)}</h3>
        <p class="muted">${escapeHtml(t.format || 'Community tournament')} · ${dateLabel}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <a class="button" href="tournament.html?id=${Number(t.id)}">View details ↗</a>
          <a class="button outline" href="tournaments.html#register" onclick="selectTournament(${Number(
            t.id
          )},'${safeJs(t.name)}',${fee})">${btnLabel}</a>
        </div>
      </article>`;
      })
      .join('');
  } catch (e) {
    container.innerHTML =
      '<p class="muted">Could not load live tournaments. Please try again later.</p>';
  }
}

function selectTournament(id, name, fee) {
  const s = document.getElementById('tournament-select');
  if (s) s.value = id;
  const n = document.getElementById('selected-tournament-name');
  if (n) n.textContent = name;
  const feeEl = document.getElementById('entry-fee-value');
  const feeNum = Number(fee) || 0;
  if (feeEl) feeEl.value = feeNum;
  const feeDisplay = document.getElementById('entry-fee-display');
  if (feeDisplay) {
    feeDisplay.textContent =
      feeNum >= 1 ? `Entry fee: R ${feeNum.toFixed(0)}` : 'Free entry';
  }

  const methodGroup = document.getElementById('payment-method-group');
  if (methodGroup) methodGroup.hidden = feeNum < 1;

  const submitBtn = document.querySelector('#registration-form [type="submit"]');
  if (submitBtn) {
    submitBtn.textContent =
      feeNum >= 1 ? `Continue · R ${feeNum.toFixed(0)} ↗` : 'Submit Registration ↗';
  }

  // Reset checkout if switching tournament mid-flow
  hideCheckoutPanel();
}

function hideCheckoutPanel() {
  const panel = document.getElementById('checkout-panel');
  if (panel) panel.hidden = true;
  const form = document.getElementById('registration-form');
  if (form) form.hidden = false;
}

function showCheckoutPanel(payload) {
  const panel = document.getElementById('checkout-panel');
  const form = document.getElementById('registration-form');
  if (!panel) return;
  if (form) form.hidden = true;
  panel.hidden = false;

  const reg = payload.registration || {};
  const bank = payload.bank_details || null;
  const status = reg.payment_status || 'awaiting_payment';
  const method = reg.payment_method || 'free';
  const amount = Number(reg.payment_amount) || 0;

  const tag = document.getElementById('checkout-status-tag');
  const title = document.getElementById('checkout-title');
  const summary = document.getElementById('checkout-summary');
  if (tag) {
    tag.textContent = statusLabel(status);
    tag.className = 'tag status-' + status.replace(/_/g, '-');
  }
  if (title) {
    title.textContent =
      status === 'paid'
        ? 'Registration confirmed'
        : method === 'eft'
          ? 'Complete EFT payment'
          : method === 'card'
            ? 'Pay with card'
            : 'You are registered';
  }
  if (summary) {
    summary.textContent = [
      reg.tournament_name || '',
      reg.player_name ? `· ${reg.player_name}` : '',
      reg.gamertag ? `· ${reg.gamertag}` : '',
    ]
      .join(' ')
      .replace(/^\s*·\s*/, '')
      .trim();
  }

  setText('checkout-reg-id', reg.registration_id || '—');
  setText('checkout-pay-ref', reg.payment_reference || '—');
  setText(
    'checkout-amount',
    amount >= 0.01 ? `R ${amount.toFixed(2)}` : 'Free'
  );

  const eft = document.getElementById('eft-block');
  const card = document.getElementById('card-block');
  const success = document.getElementById('success-block');
  if (eft) eft.hidden = true;
  if (card) card.hidden = true;
  if (success) success.hidden = true;

  if (status === 'paid' || method === 'free') {
    if (success) success.hidden = false;
  } else if (method === 'eft') {
    if (eft) eft.hidden = false;
    if (bank) {
      setText('bank-name', bank.bank_name || 'Contact NXT for bank details');
      setText('bank-account-name', bank.account_name || '—');
      setText('bank-account-number', bank.account_number || '—');
      setText('bank-branch', bank.branch_code || '—');
      setText('bank-reference', bank.reference || reg.payment_reference || '—');
    } else {
      setText('bank-name', 'Bank details not configured yet');
      setText('bank-account-name', '—');
      setText('bank-account-number', '—');
      setText('bank-branch', '—');
      setText('bank-reference', reg.payment_reference || '—');
    }
    // Store for proof submit
    panel.dataset.registrationId = reg.registration_id || '';
    panel.dataset.paymentReference = reg.payment_reference || '';
    panel.dataset.email = reg.email || '';
  } else if (method === 'card') {
    if (card) card.hidden = false;
    panel.dataset.registrationId = reg.registration_id || '';
    panel.dataset.paymentReference = reg.payment_reference || '';
    panel.dataset.email = reg.email || '';
    panel.dataset.amount = String(amount);
    panel.dataset.tournamentId = String(reg.tournament_id || '');
    panel.dataset.playerName = reg.player_name || '';
    panel.dataset.gamertag = reg.gamertag || '';
    panel.dataset.platform = reg.platform || 'PC';
    panel.dataset.eaId = reg.ea_id || '';
    panel.dataset.discord = reg.discord_username || '';
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function statusLabel(status) {
  const map = {
    awaiting_payment: 'Awaiting payment',
    payment_submitted: 'Payment submitted',
    pending_verification: 'Pending verification',
    paid: 'Paid',
    payment_rejected: 'Payment rejected',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
  };
  return map[status] || status;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

async function handleRegistration(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('[type="submit"]');

  // Brief: users must be logged in before registering
  if (supabaseClient) {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (!session) {
        notice('Sign in to register for tournaments.');
        const ret = encodeURIComponent(location.pathname + location.search + '#register');
        setTimeout(() => { location.href = 'player-login.html?next=' + ret; }, 600);
        return;
      }
    } catch {}
  }

  const values = new FormData(form);
  const tournamentId = Number(values.get('tournament_id'));
  const playerName = String(values.get('player_name') || '').trim();
  const eaId = String(values.get('ea_id') || '').trim();
  const gamertag = String(values.get('gamertag') || '').trim();
  const platform = values.get('platform') || 'PC';
  const discordUsername = String(values.get('discord_username') || '').trim();
  const email = String(values.get('email') || '').trim().toLowerCase();
  const feeInput = values.get('entry_fee');
  const entryFee = Number(
    feeInput !== null && feeInput !== ''
      ? feeInput
      : document.getElementById('entry-fee-value')?.value || 0
  );
  let paymentMethod = String(values.get('payment_method') || '').toLowerCase();
  if (entryFee < 1) paymentMethod = 'free';
  if (entryFee >= 1 && !['eft', 'card'].includes(paymentMethod)) {
    paymentMethod = 'eft';
  }

  if (!tournamentId) {
    notice('Select a tournament first.');
    return;
  }
  if (!playerName || !gamertag) {
    notice('Name and gamertag are required.');
    return;
  }
  if (entryFee >= 1 && !email) {
    notice('Email is required for paid entry.');
    return;
  }

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Creating registration…';

  try {
    const headers = { 'Content-Type': 'application/json' };
    try {
      if (supabaseClient) {
        const { data: sess } = await supabaseClient.auth.getSession();
        const token = sess?.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      }
    } catch {}

    const res = await fetch('/api/registrations', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        tournament_id: tournamentId,
        player_name: playerName,
        ea_id: eaId || undefined,
        gamertag,
        platform,
        discord_username: discordUsername || undefined,
        email: email || undefined,
        payment_method: paymentMethod,
      }),
    });

    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }

    if (!res.ok) {
      throw new Error(payload.error || 'Could not create registration.');
    }

    showCheckoutPanel(payload);

    if (payload.registration?.payment_status === 'paid') {
      notice(payload.message || 'Registration confirmed!');
      loadTournaments();
    } else if (paymentMethod === 'card') {
      notice('Registration created — continue to secure card payment.');
    } else {
      notice(payload.message || 'Registration created. Complete EFT with the reference shown.');
    }
  } catch (err) {
    notice(err.message || 'Registration failed. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function submitEftProof() {
  const panel = document.getElementById('checkout-panel');
  const fileInput = document.getElementById('eft-proof-file');
  const btn = document.getElementById('eft-submit-btn');
  if (!panel || !fileInput || !btn) return;

  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    notice('Choose a proof of payment file first.');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    notice('Proof file must be 5 MB or smaller.');
    return;
  }

  const registrationId = panel.dataset.registrationId;
  const paymentReference = panel.dataset.paymentReference;
  const email = panel.dataset.email || '';

  if (!registrationId || !paymentReference) {
    notice('Missing registration details. Please start again.');
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Uploading proof…';

  try {
    const base64 = await fileToBase64(file);
    const res = await fetch('/api/payments-eft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registration_id: registrationId,
        payment_reference: paymentReference,
        email: email || undefined,
        file_name: file.name,
        content_type: file.type || 'application/octet-stream',
        file_base64: base64,
      }),
    });

    let payload = {};
    try {
      payload = await res.json();
    } catch {
      payload = {};
    }

    if (!res.ok) {
      throw new Error(payload.error || 'Could not submit proof.');
    }

    notice(payload.message || 'Proof submitted. Pending verification.');
    // Update panel state
    const tag = document.getElementById('checkout-status-tag');
    if (tag) {
      tag.textContent = statusLabel('pending_verification');
      tag.className = 'tag status-pending-verification';
    }
    const title = document.getElementById('checkout-title');
    if (title) title.textContent = 'Proof submitted';
    const eft = document.getElementById('eft-block');
    if (eft) {
      eft.innerHTML =
        '<p style="margin:0;color:var(--success);font-weight:700">Proof received.</p>' +
        '<p class="muted" style="margin:8px 0 0;font-size:13px">An admin will verify your payment. You will be confirmed once approved.</p>';
    }
  } catch (err) {
    notice(err.message || 'Could not upload proof.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

async function startCardPaymentFromCheckout() {
  const panel = document.getElementById('checkout-panel');
  const btn = document.getElementById('card-pay-btn');
  if (!panel || !btn) return;

  const email = panel.dataset.email;
  const amount = Number(panel.dataset.amount) || 0;
  if (!email || amount < 1) {
    notice('Missing payment details. Please start registration again.');
    return;
  }

  btn.disabled = true;
  notice('Redirecting to Paystack…');

  try {
    await startPaystackPayment({
      type: 'tournament',
      email,
      amount,
      metadata: {
        nxt_type: 'tournament',
        tournament_id: Number(panel.dataset.tournamentId) || undefined,
        nxt_registration_id: panel.dataset.registrationId || undefined,
        payment_reference: panel.dataset.paymentReference || undefined,
        player_name: panel.dataset.playerName || undefined,
        gamertag: panel.dataset.gamertag || undefined,
        platform: panel.dataset.platform || 'PC',
        ea_id: panel.dataset.eaId || undefined,
        discord_username: panel.dataset.discord || undefined,
        email,
      },
      callbackPath: '/tournaments.html',
    });
  } catch (err) {
    notice(err.message || 'Could not start card payment.');
    btn.disabled = false;
  }
}

function initRegistrationCheckout() {
  const eftBtn = document.getElementById('eft-submit-btn');
  if (eftBtn) eftBtn.addEventListener('click', submitEftProof);

  const cardBtn = document.getElementById('card-pay-btn');
  if (cardBtn) cardBtn.addEventListener('click', startCardPaymentFromCheckout);

  const resetBtn = document.getElementById('checkout-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      hideCheckoutPanel();
      const form = document.getElementById('registration-form');
      if (form) form.reset();
      const nameEl = document.getElementById('selected-tournament-name');
      if (nameEl) nameEl.textContent = 'Select a tournament above';
      const feeDisplay = document.getElementById('entry-fee-display');
      if (feeDisplay) feeDisplay.textContent = 'Pick a tournament to see the entry fee';
      const feeEl = document.getElementById('entry-fee-value');
      if (feeEl) feeEl.value = '0';
      const methodGroup = document.getElementById('payment-method-group');
      if (methodGroup) methodGroup.hidden = true;
      const submitBtn = document.querySelector('#registration-form [type="submit"]');
      if (submitBtn) submitBtn.textContent = 'Submit Registration ↗';
    });
  }
}

// =====================================================
// INQUIRY FORMS → Vercel /api/inquiries (Resend)
// =====================================================
function initInquiryForms() {
  document.querySelectorAll('form[data-form-type]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formType = form.getAttribute('data-form-type');
      const btn = form.querySelector('[type="submit"]');
      const status = form.querySelector('[data-form-status]');
      const values = Object.fromEntries(new FormData(form).entries());

      if (btn) btn.disabled = true;
      if (status) status.textContent = 'Sending…';

      try {
        const res = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formType, data: values }),
        });

        let payload = {};
        try {
          payload = await res.json();
        } catch {
          payload = {};
        }

        if (!res.ok) {
          throw new Error(
            payload.error ||
              'Could not send your message. Please try Discord or email us directly.'
          );
        }

        form.reset();
        if (status) {
          status.textContent =
            formType === 'collab'
              ? 'Thanks — your collab request was sent. We will review it shortly.'
              : 'Thanks — your sponsorship enquiry was sent. We will get back to you.';
        }
        notice(
          formType === 'collab'
            ? 'Collab request sent successfully.'
            : 'Sponsorship enquiry sent successfully.'
        );
      } catch (err) {
        const msg =
          err.message ||
          'Something went wrong. Please try again or reach us on Discord.';
        if (status) status.textContent = msg;
        notice(msg);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  });
}



// =====================================================
// PLAYER AUTH + DASHBOARD + ADMIN
// =====================================================

function initPlayerAuthPage() {
  const form = document.getElementById('player-auth-form');
  if (!form || !supabaseClient) {
    const s = document.getElementById('auth-status');
    if (s) s.textContent = 'Authentication is not configured.';
    return;
  }

  let mode = 'signin';
  document.querySelectorAll('[data-auth-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      mode = btn.getAttribute('data-auth-mode');
      document.querySelectorAll('[data-auth-mode]').forEach((b) =>
        b.classList.toggle('active', b === btn)
      );
      const signupOnly = mode === 'signup';
      ['fullname-name-group', 'username-group', 'gamertag-group', 'platform-group'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = !signupOnly;
      });
      const submit = document.getElementById('auth-submit-btn');
      if (submit) submit.textContent = signupOnly ? 'Create account ↗' : 'Sign in ↗';
      const pwd = form.querySelector('[name="password"]');
      if (pwd) pwd.autocomplete = signupOnly ? 'new-password' : 'current-password';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('auth-status');
    const btn = document.getElementById('auth-submit-btn');
    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email || '').trim().toLowerCase();
    const password = String(values.password || '');
    if (!email || !password) {
      if (status) status.textContent = 'Email and password are required.';
      return;
    }
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Please wait…';

    try {
      if (mode === 'signup') {
        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: String(values.full_name || '').trim(),
              display_name: String(values.username || values.full_name || '').trim(),
              username: String(values.username || '').trim(),
            },
          },
        });
        if (error) throw error;

        const userId = data.user?.id;
        if (userId) {
          // Best-effort profile + player_profile (trigger may already create profile)
          await supabaseClient.from('profiles').upsert({
            id: userId,
            email,
            full_name: String(values.full_name || '').trim() || null,
            display_name:
              String(values.username || values.full_name || '').trim() || null,
            username: String(values.username || '').trim() || null,
          });
          await supabaseClient.from('player_profiles').upsert({
            user_id: userId,
            gamertag: String(values.gamertag || '').trim() || null,
            primary_platform: String(values.platform || '').trim() || null,
          });
        }

        if (status) {
          status.textContent = data.session
            ? 'Account created. Redirecting…'
            : 'Account created. Check your email to verify, then sign in.';
        }
        if (data.session) {
          playerAuthRedirect();
          return;
        }
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        playerAuthRedirect();
        return;
      }
    } catch (err) {
      if (status) status.textContent = err.message || 'Authentication failed.';
      notice(err.message || 'Authentication failed.');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

async function initPlayerDashboard() {
  const loading = document.getElementById('dash-loading');
  const signedOut = document.getElementById('dash-signed-out');
  const content = document.getElementById('dash-content');

  if (!supabaseClient) {
    if (loading) loading.hidden = true;
    if (signedOut) {
      signedOut.hidden = false;
      signedOut.querySelector('p').textContent =
        'Supabase is not configured on this deployment.';
    }
    return;
  }

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (loading) loading.hidden = true;

  if (!session) {
    if (signedOut) signedOut.hidden = false;
    return;
  }

  if (content) content.hidden = false;
  if (signedOut) signedOut.hidden = true;

  const user = session.user;
  const emailEl = document.getElementById('dash-email');
  if (emailEl) emailEl.textContent = user.email || '';

  // Profile
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const { data: player } = await supabaseClient
    .from('player_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  const display =
    profile?.display_name ||
    profile?.full_name ||
    profile?.username ||
    (user.email ? user.email.split('@')[0] : 'Player');
  const nameEl = document.getElementById('dash-display-name');
  if (nameEl) nameEl.textContent = display;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v || '';
  };
  setVal('profile-display-name', profile?.display_name || profile?.full_name);
  setVal('profile-username', profile?.username);
  setVal('profile-gamertag', player?.gamertag);
  setVal('profile-ea-id', player?.ea_id);
  setVal('profile-platform', player?.primary_platform);
  setVal('profile-discord', profile?.discord_username);

  // Registrations owned by this user
  const { data: regs, error: regErr } = await supabaseClient
    .from('registrations')
    .select('*, tournaments(name, format, status, entry_fee, starts_at)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const list = document.getElementById('dash-registrations');
  const rows = !regErr && Array.isArray(regs) ? regs : [];

  const paid = rows.filter((r) => r.payment_status === 'paid').length;
  const pending = rows.filter((r) =>
    ['awaiting_payment', 'payment_submitted', 'pending_verification'].includes(
      r.payment_status
    )
  ).length;
  setText('stat-total', String(rows.length));
  setText('stat-paid', String(paid));
  setText('stat-pending', String(pending));

  if (list) {
    if (!rows.length) {
      list.innerHTML =
        '<div class="panel"><p class="muted" style="margin:0">No tournament registrations linked to this account yet. <a href="tournaments.html#register" style="color:var(--blue2)">Enter a tournament</a> while signed in.</p></div>';
    } else {
      list.innerHTML = rows
        .map((r) => {
          const t = r.tournaments || {};
          const fee = Number(r.payment_amount) || 0;
          return `
        <article class="event-card">
          <div class="event-status">${escapeHtml(statusLabel(r.payment_status))}</div>
          <h3>${escapeHtml(t.name || 'Tournament')}</h3>
          <p class="muted" style="font-size:13px">
            ${escapeHtml(r.gamertag || '')} · ${escapeHtml(r.platform || '')}<br>
            Ref ${escapeHtml(r.registration_id || '')}<br>
            ${fee >= 0.01 ? 'R ' + fee.toFixed(2) : 'Free'} · ${escapeHtml(r.payment_method || '')}
          </p>
          <a class="button outline" href="tournaments.html">View tournaments</a>
        </article>`;
        })
        .join('');
    }
  }

  const signOutBtn = document.getElementById('dash-signout');
  if (signOutBtn) {
    signOutBtn.onclick = async () => {
      await supabaseClient.auth.signOut();
      location.href = 'player-login.html';
    };
  }

  const profileForm = document.getElementById('player-profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('profile-status');
      const values = Object.fromEntries(new FormData(profileForm).entries());
      if (status) status.textContent = 'Saving…';
      try {
        const { error: pErr } = await supabaseClient.from('profiles').upsert({
          id: user.id,
          email: user.email,
          display_name: String(values.display_name || '').trim() || null,
          username: String(values.username || '').trim() || null,
          discord_username: String(values.discord_username || '').trim() || null,
        });
        if (pErr) throw pErr;
        const { error: plErr } = await supabaseClient.from('player_profiles').upsert({
          user_id: user.id,
          gamertag: String(values.gamertag || '').trim() || null,
          ea_id: String(values.ea_id || '').trim() || null,
          primary_platform: String(values.platform || '').trim() || null,
        });
        if (plErr) throw plErr;
        if (status) status.textContent = 'Profile saved.';
        notice('Profile saved.');
        const dn = document.getElementById('dash-display-name');
        if (dn) dn.textContent = values.display_name || display;
      } catch (err) {
        if (status) status.textContent = err.message || 'Could not save profile.';
        notice(err.message || 'Could not save profile.');
      }
    });
  }
}

function initAdminPaymentsPage() {
  const loadBtn = document.getElementById('admin-load-btn');
  const exportBtn = document.getElementById('admin-export-btn');
  const list = document.getElementById('admin-list');
  const statusEl = document.getElementById('admin-status');
  let lastRows = [];

  async function load() {
    const key = document.getElementById('admin-key')?.value?.trim();
    const filter = document.getElementById('admin-status-filter')?.value || '';
    if (!key) {
      if (statusEl) statusEl.textContent = 'Enter the admin key.';
      return;
    }
    if (statusEl) statusEl.textContent = 'Loading…';
    try {
      const res = await fetch('/api/admin-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          admin_key: key,
          payment_status: filter || undefined,
          limit: 100,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Load failed');
      lastRows = payload.registrations || [];
      setText(
        'admin-revenue',
        'R ' + (Number(payload.total_confirmed_revenue) || 0).toFixed(2)
      );
      if (statusEl) statusEl.textContent = `${lastRows.length} registration(s)`;
      renderAdminRows(lastRows, key);
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Failed';
      if (list) list.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Failed')}</p>`;
    }
  }

  function renderAdminRows(rows, key) {
    if (!list) return;
    if (!rows.length) {
      list.innerHTML = '<p class="muted">No registrations for this filter.</p>';
      return;
    }
    list.innerHTML = rows
      .map((r) => {
        const tName = r.tournaments?.name || 'Tournament #' + r.tournament_id;
        const canAct = ['pending_verification', 'payment_submitted', 'awaiting_payment'].includes(
          r.payment_status
        );
        return `
      <article class="panel admin-reg-card" data-reg="${escapeHtml(r.registration_id)}">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start">
          <div>
            <div class="tag status-${String(r.payment_status || '').replace(/_/g, '-')}">${escapeHtml(statusLabel(r.payment_status))}</div>
            <h3 style="margin:8px 0 4px;font-size:16px">${escapeHtml(tName)}</h3>
            <p class="muted" style="margin:0;font-size:13px">
              ${escapeHtml(r.player_name || '')} · ${escapeHtml(r.gamertag || '')} · ${escapeHtml(r.platform || '')}<br>
              ${escapeHtml(r.email || 'no email')} · ${escapeHtml(r.payment_method || '')}<br>
              Reg ${escapeHtml(r.registration_id || '')} · Pay ${escapeHtml(r.payment_reference || '')}<br>
              R ${(Number(r.payment_amount) || 0).toFixed(2)}
            </p>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;min-width:140px">
            ${
              canAct
                ? `<button type="button" class="button" data-admin-action="approve" data-id="${escapeHtml(r.registration_id)}">Approve</button>
                   <button type="button" class="outline" data-admin-action="reject" data-id="${escapeHtml(r.registration_id)}">Reject</button>`
                : ''
            }
          </div>
        </div>
      </article>`;
      })
      .join('');

    list.querySelectorAll('[data-admin-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.getAttribute('data-admin-action');
        const id = btn.getAttribute('data-id');
        btn.disabled = true;
        try {
          const res = await fetch('/api/admin-payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action,
              admin_key: key,
              registration_id: id,
            }),
          });
          const payload = await res.json();
          if (!res.ok) throw new Error(payload.error || 'Action failed');
          notice(payload.message || 'Updated');
          load();
        } catch (err) {
          notice(err.message || 'Action failed');
          btn.disabled = false;
        }
      });
    });
  }

  if (loadBtn) loadBtn.addEventListener('click', load);
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!lastRows.length) {
        notice('Load registrations first.');
        return;
      }
      const headers = [
        'registration_id',
        'payment_reference',
        'player_name',
        'gamertag',
        'email',
        'platform',
        'payment_method',
        'payment_status',
        'payment_amount',
        'tournament_id',
        'created_at',
      ];
      const lines = [headers.join(',')];
      lastRows.forEach((r) => {
        lines.push(
          headers
            .map((h) => {
              const v = r[h] == null ? '' : String(r[h]);
              return `"${v.replace(/"/g, '""')}"`;
            })
            .join(',')
        );
      });
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'nxt-registrations.csv';
      a.click();
    });
  }
}




// =====================================================
// CREATOR DASHBOARD v2 + TOURNAMENT CREATE
// =====================================================

async function getAccessToken() {
  if (!supabaseClient) return null;
  const { data } = await supabaseClient.auth.getSession();
  return data?.session?.access_token || null;
}

async function prefillRegistrationFromSession() {
  const form = document.getElementById('registration-form');
  if (!form || !supabaseClient) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.user) return;
    const uid = session.user.id;
    const emailInput = form.querySelector('[name="email"]');
    if (emailInput && !emailInput.value) {
      emailInput.value = session.user.email || '';
    }
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('display_name,full_name,discord_username')
      .eq('id', uid)
      .maybeSingle();
    const { data: player } = await supabaseClient
      .from('player_profiles')
      .select('gamertag,ea_id,primary_platform')
      .eq('user_id', uid)
      .maybeSingle();
    const setIfEmpty = (name, val) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && !el.value && val) el.value = val;
    };
    setIfEmpty('player_name', profile?.full_name || profile?.display_name);
    setIfEmpty('discord_username', profile?.discord_username);
    setIfEmpty('gamertag', player?.gamertag);
    setIfEmpty('ea_id', player?.ea_id);
    if (player?.primary_platform) {
      const sel = form.querySelector('[name="platform"]');
      if (sel && !sel.value) sel.value = player.primary_platform;
    }
  } catch (e) {
    console.warn('prefill registration', e);
  }
}

async function initCreatorDashboardV2() {
  const root = document.getElementById('creator-dash-root');
  if (!root) return;

  if (!supabaseClient) {
    root.innerHTML = `<div class="panel" style="padding:28px"><p class="muted">Supabase is not configured.</p></div>`;
    return;
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    root.innerHTML = `
      <div class="panel" style="padding:28px;text-align:center">
        <div class="eyebrow">CREATOR PORTAL</div>
        <h2 style="margin:10px 0">Sign in to manage tournaments</h2>
        <p class="muted">Use the creator login with your NXT account.</p>
        <a class="button" href="creator-login.html" style="margin-top:12px">Creator login ↗</a>
        <p class="muted" style="margin-top:14px;font-size:13px">Players can also use <a href="player-login.html" style="color:var(--blue2)">player login</a> — same Supabase auth.</p>
      </div>`;
    return;
  }

  const user = session.user;
  const token = session.access_token;

  // Ensure profile + optional creator role display
  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  const { data: rolesData } = await supabaseClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);
  const roles = (rolesData || []).map((r) => r.role);

  const display =
    profile?.display_name ||
    profile?.full_name ||
    (user.email ? user.email.split('@')[0] : 'Creator');

  root.innerHTML = `
    <div class="dashboard-welcome panel">
      <div class="eyebrow">CREATOR DASHBOARD</div>
      <h1 style="margin:8px 0 4px;font-size:28px">Hey, ${escapeHtml(display)}</h1>
      <p class="muted" style="margin:0">${escapeHtml(user.email || '')}

        ${roles.length ? ' · roles: ' + escapeHtml(roles.join(', ')) : ''}</p>
      <div class="dashboard-actions">
        <a class="button outline" href="player-dashboard.html">Player dashboard</a>
        <button type="button" class="outline" id="creator-signout-v2">Sign out</button>
      </div>
      <div class="dashboard-note" style="margin-top:14px">
        To create tournaments you need a <strong>creator</strong> or <strong>organiser</strong> role
        (or an approved creator profile). Admins can grant roles in SQL — see PLATFORM.md.
      </div>
    </div>

    <div class="grid-2" style="margin-top:24px;align-items:start">
      <form id="create-tournament-form" class="panel">
        <div class="tag">New competition</div>
        <h3 style="margin:10px 0 14px">Create tournament</h3>
        <div class="form-group">
          <label>Tournament name</label>
          <input name="name" required placeholder="e.g. Teazers R6 Open">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Game</label>
            <select name="game_slug" id="create-game-select">
              <option value="">Select game…</option>
            </select>
          </div>
          <div class="form-group">
            <label>Format</label>
            <select name="format">
              <option>Single elimination</option>
              <option>Double elimination</option>
              <option>Round robin</option>
              <option>Groups + knockout</option>
              <option>League</option>
              <option>Custom</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Entry fee (ZAR)</label>
            <input type="number" name="entry_fee" min="0" step="1" value="0">
          </div>
          <div class="form-group">
            <label>Max players</label>
            <input type="number" name="max_players" min="2" step="1" placeholder="e.g. 32">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Platform</label>
            <select name="platform">
              <option>PC</option>
              <option>PlayStation</option>
              <option>Xbox</option>
              <option>Mobile</option>
              <option>Cross-play</option>
            </select>
          </div>
          <div class="form-group">
            <label>Region</label>
            <input name="region" placeholder="South Africa" value="South Africa">
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" rows="3" placeholder="What players should know"></textarea>
        </div>
        <div class="form-group">
          <label>Rules (optional)</label>
          <textarea name="rules" rows="3" placeholder="Eligibility, forfeit, dispute rules"></textarea>
        </div>
        <div class="form-group">
          <label>Prize description (optional)</label>
          <input name="prize_description" placeholder="e.g. R2000 prize pool">
        </div>
        <div class="form-group">
          <label>Publish status</label>
          <select name="status">
            <option value="draft">Save as draft</option>
            <option value="open">Open registrations now</option>
          </select>
        </div>
        <button type="submit" class="button" style="width:100%;padding:14px">Create tournament ↗</button>
        <p class="form-status" id="create-tournament-status"></p>
      </form>

      <div>
        <div class="sectionhead" style="margin-bottom:12px">
          <div>
            <div class="kicker">Your events</div>
            <h2 style="font-size:20px;margin:0">Tournaments you organise</h2>
          </div>
        </div>
        <div id="creator-tournaments-list" class="admin-list">
          <p class="muted">Loading…</p>
        </div>

        <div class="panel" style="margin-top:20px" id="fixture-manager">
          <div class="tag">Fixtures</div>
          <h3 style="margin:10px 0 12px">Add match</h3>
          <p class="muted" style="font-size:13px;margin:0 0 12px">Requires <code>fixtures.sql</code>. Select a tournament you organise.</p>
          <div class="form-group">
            <label>Tournament ID</label>
            <input type="number" id="fixture-tournament-id" placeholder="From your list above">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Player 1</label>
              <input id="fixture-p1" placeholder="Name / gamertag">
            </div>
            <div class="form-group">
              <label>Player 2</label>
              <input id="fixture-p2" placeholder="Name / gamertag">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Round</label>
              <input id="fixture-round" placeholder="e.g. Semi-final">
            </div>
            <div class="form-group">
              <label>Match #</label>
              <input type="number" id="fixture-num" placeholder="1">
            </div>
          </div>
          <button type="button" class="button" id="fixture-create-btn" style="width:100%">Create match ↗</button>
          <p class="form-status" id="fixture-status"></p>
          <hr style="border:0;border-top:1px solid var(--line);margin:18px 0">
          <h3 style="margin:0 0 12px;font-size:16px">Record result</h3>
          <div class="form-group"><label>Match ID</label><input id="result-match-id" placeholder="UUID from fixtures list"></div>
          <div class="form-row">
            <div class="form-group"><label>P1 score</label><input type="number" id="result-p1" value="0"></div>
            <div class="form-group"><label>P2 score</label><input type="number" id="result-p2" value="0"></div>
          </div>
          <button type="button" class="button outline" id="result-save-btn" style="width:100%">Save result ↗</button>
          <p class="form-status" id="result-status"></p>
        </div>
      </div>
    </div>
  `;

  document.getElementById('creator-signout-v2')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    location.href = 'creator-login.html';
  });

  // Load games into select
  try {
    const gRes = await fetch('/api/tournaments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action: 'list_games' }),
    });
    const gPayload = await gRes.json();
    const sel = document.getElementById('create-game-select');
    if (sel && Array.isArray(gPayload.games)) {
      gPayload.games.forEach((g) => {
        const opt = document.createElement('option');
        opt.value = g.slug;
        opt.textContent = g.name;
        sel.appendChild(opt);
      });
    }
  } catch {}

  async function refreshMine() {
    const list = document.getElementById('creator-tournaments-list');
    if (!list) return;
    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'list_mine' }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Could not load');
      const rows = payload.tournaments || [];
      if (!rows.length) {
        list.innerHTML =
          '<div class="panel"><p class="muted" style="margin:0">No tournaments yet. Create one on the left.</p></div>';
        return;
      }
      list.innerHTML = rows
        .map((t) => {
          const fee = Number(t.entry_fee) || 0;
          return `
          <article class="panel admin-reg-card">
            <div class="tag">${escapeHtml(String(t.status || 'draft').toUpperCase())}</div>
            <h3 style="margin:8px 0 4px;font-size:16px">${escapeHtml(t.name)}</h3>
            <p class="muted" style="margin:0;font-size:13px">
              ${escapeHtml(t.format || 'Format TBA')} · ${fee >= 1 ? 'R ' + fee.toFixed(0) : 'Free'}
              ${t.max_players ? ' · max ' + t.max_players : ''}<br>
              ${escapeHtml(t.platform || '')} ${t.region ? '· ' + escapeHtml(t.region) : ''}
            </p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
              ${
                t.status === 'draft'
                  ? `<button type="button" class="button" data-set-status="open" data-id="${t.id}">Open registrations</button>`
                  : ''
              }
              ${
                t.status === 'open'
                  ? `<button type="button" class="outline" data-set-status="closed" data-id="${t.id}">Close registration</button>`
                  : ''
              }
              <a class="button outline" href="tournaments.html">View public list</a>
            </div>
          </article>`;
        })
        .join('');

      list.querySelectorAll('[data-set-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res2 = await fetch('/api/tournaments', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                action: 'set_status',
                tournament_id: Number(btn.getAttribute('data-id')),
                status: btn.getAttribute('data-set-status'),
              }),
            });
            const p = await res2.json();
            if (!res2.ok) throw new Error(p.error || 'Update failed');
            notice('Tournament updated');
            refreshMine();
          } catch (err) {
            notice(err.message || 'Update failed');
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Failed to load')}</p>`;
    }
  }

  await refreshMine();

  document.getElementById('fixture-create-btn')?.addEventListener('click', async () => {
    const status = document.getElementById('fixture-status');
    const tournament_id = Number(document.getElementById('fixture-tournament-id')?.value);
    if (!tournament_id) {
      if (status) status.textContent = 'Enter a tournament ID from your list.';
      return;
    }
    if (status) status.textContent = 'Creating…';
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'create',
          tournament_id,
          player1_name: document.getElementById('fixture-p1')?.value,
          player2_name: document.getElementById('fixture-p2')?.value,
          round_label: document.getElementById('fixture-round')?.value,
          match_number: document.getElementById('fixture-num')?.value,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed');
      if (status) status.textContent = 'Match created: ' + (payload.match?.id || 'ok');
      notice('Match created');
    } catch (err) {
      if (status) status.textContent = err.message || 'Failed';
      notice(err.message || 'Could not create match');
    }
  });

  document.getElementById('result-save-btn')?.addEventListener('click', async () => {
    const status = document.getElementById('result-status');
    const match_id = document.getElementById('result-match-id')?.value?.trim();
    if (!match_id) {
      if (status) status.textContent = 'Match ID required.';
      return;
    }
    if (status) status.textContent = 'Saving…';
    try {
      const res = await fetch('/api/matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'update_result',
          match_id,
          player1_score: Number(document.getElementById('result-p1')?.value),
          player2_score: Number(document.getElementById('result-p2')?.value),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed');
      if (status) status.textContent = 'Result saved.';
      notice('Result saved');
    } catch (err) {
      if (status) status.textContent = err.message || 'Failed';
      notice(err.message || 'Could not save result');
    }
  });

  const form = document.getElementById('create-tournament-form');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('create-tournament-status');
    const btn = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Creating…';
    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'create',
          name: values.name,
          game_slug: values.game_slug || undefined,
          format: values.format,
          entry_fee: Number(values.entry_fee) || 0,
          max_players: values.max_players ? Number(values.max_players) : undefined,
          platform: values.platform,
          region: values.region,
          description: values.description,
          rules: values.rules,
          prize_description: values.prize_description,
          status: values.status || 'draft',
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Create failed');
      if (status) status.textContent = payload.message || 'Created.';
      notice(payload.message || 'Tournament created');
      form.reset();
      refreshMine();
    } catch (err) {
      if (status) status.textContent = err.message || 'Failed';
      notice(err.message || 'Could not create tournament');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}




// =====================================================
// TOURNAMENT DETAIL + CREATOR APPLY
// =====================================================

async function initTournamentDetailPage() {
  const root = document.getElementById('tournament-detail-root');
  if (!root) return;

  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) {
    root.innerHTML = `<div class="panel" style="padding:28px"><p class="muted">Missing tournament id. <a href="tournaments.html" style="color:var(--blue2)">Browse tournaments</a></p></div>`;
    return;
  }

  if (!supabaseClient) {
    root.innerHTML = `<div class="panel" style="padding:28px"><p class="muted">Supabase is not configured.</p></div>`;
    return;
  }

  try {
    const { data: t, error } = await supabaseClient
      .from('tournaments')
      .select('*, games(name,slug)')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    if (!t) {
      root.innerHTML = `<div class="panel" style="padding:28px"><p class="muted">Tournament not found.</p><a class="button" href="tournaments.html">Back</a></div>`;
      return;
    }

    const fee = Number(t.entry_fee) || 0;
    const feeLabel = fee >= 1 ? `R ${fee.toFixed(2)}` : 'Free entry';
    const gameName = t.games?.name || t.game || 'Multi-game';
    const starts = t.starts_at
      ? new Date(t.starts_at).toLocaleString('en-ZA')
      : 'TBA';
    const closes = t.registration_closes_at
      ? new Date(t.registration_closes_at).toLocaleString('en-ZA')
      : 'Open';

    // Paid / confirmed count (best effort)
    let spots = '';
    if (t.max_players) {
      const { count } = await supabaseClient
        .from('registrations')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id)
        .eq('payment_status', 'paid');
      const used = count || 0;
      spots = `${used} / ${t.max_players} confirmed`;
    }

    document.title = `${t.name} — NXT`;

    root.innerHTML = `
      <div class="panel" style="padding:28px">
        <div class="tag">${escapeHtml(String(t.status || '').toUpperCase())} · ${escapeHtml(feeLabel)}</div>
        <h1 style="margin:12px 0 8px;font-size:clamp(28px,4vw,40px);letter-spacing:-.03em">${escapeHtml(t.name)}</h1>
        <p class="muted" style="margin:0 0 18px">
          ${escapeHtml(gameName)} · ${escapeHtml(t.format || 'Format TBA')}
          ${t.platform ? ' · ' + escapeHtml(t.platform) : ''}
          ${t.region ? ' · ' + escapeHtml(t.region) : ''}
        </p>

        <div class="checkout-meta" style="margin-bottom:20px">
          <div><span>Starts</span><strong>${escapeHtml(starts)}</strong></div>
          <div><span>Registration</span><strong>${escapeHtml(closes)}</strong></div>
          <div><span>Spaces</span><strong>${escapeHtml(spots || (t.max_players ? 'Max ' + t.max_players : 'Open'))}</strong></div>
        </div>

        ${
          t.description
            ? `<h3 style="margin:0 0 8px">About</h3><p style="margin:0 0 18px;line-height:1.6">${escapeHtml(t.description)}</p>`
            : ''
        }
        ${
          t.prize_description
            ? `<h3 style="margin:0 0 8px">Prizes</h3><p class="muted" style="margin:0 0 18px">${escapeHtml(t.prize_description)}</p>`
            : ''
        }
        ${
          t.rules
            ? `<h3 style="margin:0 0 8px">Rules</h3><p class="muted" style="margin:0 0 18px;white-space:pre-wrap">${escapeHtml(t.rules)}</p>`
            : ''
        }

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${
            ['open', 'live'].includes(t.status)
              ? `<a class="button" href="tournaments.html#register" onclick="sessionStorage.setItem('nxt_select_tournament', JSON.stringify({id:${Number(t.id)},name:${JSON.stringify(t.name)},fee:${fee}}))">Register for this event ↗</a>`
              : `<span class="muted">Registration is not open.</span>`
          }
          <a class="button outline" href="tournaments.html">All tournaments</a>
          <a class="button outline" href="player-login.html">Player login</a>
        </div>
      </div>
      <div class="sectionhead" style="margin-top:32px">
        <div>
          <div class="kicker">Fixtures</div>
          <h2>Match schedule &amp; results</h2>
        </div>
      </div>
      <div id="tournament-matches" class="admin-list">
        <p class="muted">Loading fixtures…</p>
      </div>
    `;

    loadTournamentMatches(id);
  } catch (err) {
    root.innerHTML = `<div class="panel" style="padding:28px"><p class="muted">${escapeHtml(err.message || 'Could not load tournament.')}</p></div>`;
  }
}

async function loadTournamentMatches(tournamentId) {
  const box = document.getElementById('tournament-matches');
  if (!box) return;
  try {
    const res = await fetch('/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list', tournament_id: tournamentId }),
    });
    const payload = await res.json();
    const matches = payload.matches || [];
    if (!matches.length) {
      box.innerHTML =
        '<div class="empty-state">No fixtures published yet. Organisers can add matches from the creator dashboard after applying fixtures.sql.</div>';
      return;
    }
    box.innerHTML = matches
      .map((m) => {
        const score =
          m.status === 'completed' && m.player1_score != null
            ? `${m.player1_score} – ${m.player2_score}`
            : 'vs';
        const when = m.scheduled_at
          ? new Date(m.scheduled_at).toLocaleString('en-ZA')
          : 'Time TBA';
        return `<article class="panel admin-reg-card">
          <div class="tag">${escapeHtml(String(m.status || '').toUpperCase())}${m.round_label ? ' · ' + escapeHtml(m.round_label) : ''}</div>
          <h3 style="margin:8px 0 4px;font-size:16px">
            ${escapeHtml(m.player1_name || 'TBD')}
            <span class="muted" style="font-weight:600"> ${escapeHtml(score)} </span>
            ${escapeHtml(m.player2_name || 'TBD')}
          </h3>
          <p class="muted" style="margin:0;font-size:13px">${escapeHtml(when)}
            ${m.winner_name ? ' · Winner: ' + escapeHtml(m.winner_name) : ''}
          </p>
        </article>`;
      })
      .join('');
  } catch (err) {
    box.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Could not load fixtures.')}</p>`;
  }
}

function applyPendingTournamentSelection() {
  try {
    const raw = sessionStorage.getItem('nxt_select_tournament');
    if (!raw) return;
    sessionStorage.removeItem('nxt_select_tournament');
    const t = JSON.parse(raw);
    if (t?.id) selectTournament(t.id, t.name || 'Tournament', t.fee || 0);
  } catch {}
}

async function initCreatorApplyPage() {
  const form = document.getElementById('creator-apply-form');
  if (!form) return;

  // Prefill email if signed in
  try {
    if (supabaseClient) {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session?.user?.email) {
        const email = form.querySelector('[name="email"]');
        if (email) email.value = session.user.email;
      }
    }
  } catch {}

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('creator-apply-status');
    const btn = form.querySelector('[type="submit"]');
    const values = Object.fromEntries(new FormData(form).entries());
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Submitting…';

    const headers = { 'Content-Type': 'application/json' };
    try {
      if (supabaseClient) {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
      }
    } catch {}

    try {
      const res = await fetch('/api/creator-applications', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'apply', ...values }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Submit failed');
      if (status) status.textContent = payload.message || 'Submitted.';
      notice(payload.message || 'Application submitted');
      form.reset();
    } catch (err) {
      if (status) status.textContent = err.message || 'Failed';
      notice(err.message || 'Could not submit application');
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}




function initAdminCreatorApplications() {
  const loadBtn = document.getElementById('admin-load-creators-btn');
  const list = document.getElementById('admin-creator-list');
  const statusEl = document.getElementById('admin-creator-status');
  if (!loadBtn || !list) return;

  async function load() {
    const key = document.getElementById('admin-key')?.value?.trim();
    const filter = document.getElementById('creator-app-filter')?.value ?? 'pending';
    if (!key) {
      if (statusEl) statusEl.textContent = 'Enter the admin key above.';
      return;
    }
    if (statusEl) statusEl.textContent = 'Loading…';
    try {
      const res = await fetch('/api/creator-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          admin_key: key,
          status: filter || undefined,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Load failed');
      const rows = payload.applications || [];
      if (statusEl) statusEl.textContent = `${rows.length} application(s)`;
      if (!rows.length) {
        list.innerHTML = '<p class="muted">No applications for this filter.</p>';
        return;
      }
      list.innerHTML = rows
        .map((a) => `
        <article class="panel admin-reg-card">
          <div class="tag">${escapeHtml(String(a.status || '').toUpperCase())}</div>
          <h3 style="margin:8px 0 4px;font-size:16px">${escapeHtml(a.display_name || '')}</h3>
          <p class="muted" style="margin:0;font-size:13px">
            ${escapeHtml(a.email || '')} · ${escapeHtml(a.category || '')}<br>
            ${escapeHtml(a.bio || '').slice(0, 180)}
            ${a.twitch_url ? '<br>Twitch: ' + escapeHtml(a.twitch_url) : ''}
          </p>
          ${
            a.status === 'pending'
              ? `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                  <button type="button" class="button" data-creator-decision="approved" data-id="${escapeHtml(a.id)}">Approve</button>
                  <button type="button" class="outline" data-creator-decision="rejected" data-id="${escapeHtml(a.id)}">Reject</button>
                </div>`
              : ''
          }
        </article>`)
        .join('');

      list.querySelectorAll('[data-creator-decision]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            const res2 = await fetch('/api/creator-applications', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'review',
                admin_key: key,
                application_id: btn.getAttribute('data-id'),
                decision: btn.getAttribute('data-creator-decision'),
              }),
            });
            const p = await res2.json();
            if (!res2.ok) throw new Error(p.error || 'Review failed');
            notice(p.message || 'Updated');
            load();
          } catch (err) {
            notice(err.message || 'Failed');
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      if (statusEl) statusEl.textContent = err.message || 'Failed';
      list.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Failed')}</p>`;
    }
  }

  loadBtn.addEventListener('click', load);
}




async function initHomePage() {
  // Featured tournaments from Supabase
  const box = document.getElementById('home-tournaments');
  if (box && supabaseClient) {
    try {
      let { data, error } = await supabaseClient
        .from('tournaments')
        .select('*')
        .in('status', ['open', 'live'])
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      if (!data?.length) {
        box.innerHTML = '<div class="empty-state">No open tournaments right now. Check back soon or follow Discord for announcements.</div>';
      } else {
        box.innerHTML = data.map((t) => {
          const fee = Number(t.entry_fee) || 0;
          const feeLabel = fee >= 1 ? `R ${fee.toFixed(0)}` : 'Free';
          const dateRaw = t.starts_at || t.event_date;
          const dateLabel = dateRaw ? new Date(dateRaw).toLocaleDateString('en-ZA') : 'Date TBA';
          return `<article class="event-card">
            <div class="event-status">${escapeHtml(String(t.status||'open').toUpperCase())} · ${feeLabel}</div>
            <h3>${escapeHtml(t.name)}</h3>
            <p class="muted">${escapeHtml(t.format || 'Community tournament')} · ${dateLabel}</p>
            <a class="button" href="tournament.html?id=${Number(t.id)}">View tournament</a>
          </article>`;
        }).join('');
      }
    } catch {
      box.innerHTML = '<div class="empty-state">Tournaments will appear here when the connection is ready.</div>';
    }
  } else if (box) {
    box.innerHTML = '<div class="empty-state">Tournaments will appear here when the connection is ready.</div>';
  }

  // Featured creators from static roster (until DB profiles drive directory)
  const creatorsBox = document.getElementById('home-creators');
  if (creatorsBox && typeof NXT_CREATORS === 'object') {
    const entries = Object.entries(NXT_CREATORS).slice(0, 3);
    if (!entries.length) {
      creatorsBox.innerHTML = '<div class="empty-state">Creator profiles coming soon.</div>';
    } else {
      creatorsBox.innerHTML = entries.map(([id, c]) => `
        <article class="card">
          <h3>${escapeHtml(c.name || id)}</h3>
          <p class="muted">${escapeHtml((c.games || []).slice(0, 3).join(' · ') || 'Creator')}</p>
          <p>${escapeHtml((c.bio || '').slice(0, 120))}</p>
          <a href="creator.html?id=${encodeURIComponent(id)}">View profile</a>
        </article>`).join('');
    }
  }
}


document.addEventListener('DOMContentLoaded', () => {
  updateCartUI();
  checkPaymentReturn();
  initRevealAnimations();
  initCreatorProfileLinks();
  renderCreatorProfile();
  initCreatorAuth();
  initCreatorDashboard();
  renderTournaments();
  loadTournaments();
  initInquiryForms();
  initRegistrationCheckout();
  prefillRegistrationFromSession();
  applyPendingTournamentSelection();

  const f = document.getElementById('registration-form');
  if (f) f.addEventListener('submit', handleRegistration);

  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.links a,.mobile-menu a').forEach((a) => {
    if (a.getAttribute('href') === current) a.classList.add('active');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCart();
      closeMenu();
    }
  });
});
