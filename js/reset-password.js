/* Forgot / reset password. Supabase puts a recovery session in the URL hash; detectSessionInUrl picks it up. */
(function () {
  const { esc, sb, act, toast, friendly } = NXT;
  const root = document.getElementById('app');
  let recovery = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);

  function requestForm() {
    root.innerHTML = `<form class="panel stack" id="rq" style="max-width:460px;margin:30px auto"><h1 style="margin:0;font-size:30px">Reset your password</h1><p class="muted" style="margin:0">Enter your account email and we’ll send a reset link.</p><div class="form-group"><label for="em">Email</label><input id="em" type="email" required autocomplete="email"></div><button class="button" type="submit">Send reset link</button><a href="player-login.html" class="muted-sm">Back to sign in</a><p id="msg" class="muted-sm" role="status"></p></form>`;
    document.getElementById('rq').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await act(e.submitter, async () => { const { error } = await sb.auth.resetPasswordForEmail(document.getElementById('em').value.trim(), { redirectTo: `${location.origin}/reset-password.html` }); if (error) throw error; });
      // Same message whether or not the account exists (no account enumeration).
      if (r !== undefined) document.getElementById('msg').textContent = 'If an account exists for that email, a reset link is on its way.';
    });
  }
  function newForm() {
    root.innerHTML = `<form class="panel stack" id="np" style="max-width:460px;margin:30px auto"><h1 style="margin:0;font-size:30px">Choose a new password</h1><div class="form-group"><label for="a">New password (min. 8 characters)</label><input id="a" type="password" minlength="8" required autocomplete="new-password"></div><div class="form-group"><label for="b">Confirm password</label><input id="b" type="password" minlength="8" required autocomplete="new-password"></div><button class="button" type="submit">Update password</button></form>`;
    document.getElementById('np').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = document.getElementById('a').value;
      if (a !== document.getElementById('b').value) { toast('Passwords do not match.'); return; }
      const r = await act(e.submitter, async () => { const { error } = await sb.auth.updateUser({ password: a }); if (error) throw error; }, 'Password updated. Signing you in…');
      if (r !== undefined) setTimeout(() => (location.href = 'player-dashboard.html'), 1200);
    });
  }
  sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') { recovery = true; newForm(); } });
  if (recovery) newForm(); else requestForm();
})();
