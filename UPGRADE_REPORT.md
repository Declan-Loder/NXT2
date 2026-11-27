# NXT upgrade report

Built on the provided ZIP. Nothing was discarded: same static-site + Vercel functions + Supabase architecture,
same brand tokens, same registration / EFT / Paystack / creator-application flows.

**Read this first.** I had no network and no Postgres in my environment. JavaScript was syntax-checked and the new
pages were exercised in a real headless browser against a *stubbed* Supabase (`tests/smoke.py`). The two SQL files
(`hardening.sql`, `platform-v3.sql`) were reviewed line by line and cross-checked against the original schema's column
names, but **have never been executed**. Run them in a staging Supabase project first and expect to fix a few
small things. The browser tests prove the UI renders and escapes data; they do **not** prove the database
permissions work. Treat "Security rules" and "Database permissions" from your checklist as *not yet verified*.

---

## 1. What was in the ZIP

- **Stack:** static multi-page HTML/CSS/vanilla JS (`app.js`, 2.5k lines), Vercel serverless functions (`api/`), Supabase
  (Auth, Postgres, Storage). Not React/Next.
- **Working:** tournament list/detail/registration, free + EFT (with proof upload) + Paystack card payments, admin payment
  approval, creator applications → creator profile, creator dashboard (create tournaments / fixtures / results),
  player dashboard, Resend emails, audit log.
- **Auth:** Supabase email/password only. No password reset, change password, OAuth, or email-verify handling.
- **Roles:** `user_roles` (player, creator, organiser, moderator, admin, superadmin) but only used by the API.

## 2. Problems found in the original (all fixed unless noted)

| Severity | Issue | Fix |
|---|---|---|
| Critical | `escapeHtml()` escaped nothing (`'&': '&'`) → stored XSS everywhere `innerHTML` is used | Fixed + verified in browser with a payload |
| Critical | Anyone could `INSERT` a registration with `payment_status='paid'` via the public anon key; `app.js` even did this itself | Client insert removed; RLS write access revoked (`hardening.sql`) |
| Critical | Paystack init trusted the client amount; verify never compared amount to the fee (pay R1, get a R100 entry) | Amount/email now read from the registration row; verify checks currency, amount ≥ fee, one-reference-one-registration; legacy "create paid row from metadata" path deleted |
| Critical | `registrations` read policy had `OR user_id IS NULL` → every guest's name/email/phone/payment ref world-readable | Owner-only (+ admin) |
| High | `profiles.email` / `full_name` world-readable; users could edit their own `account_status` | Column-level grants; `get_my_profile()` RPC for your own data |
| High | Any user could insert an `approved` `creator_profiles` row (self-verify) | Insert/verify revoked; only editable presentation columns |
| High | `announcements`, `audit_logs`, `game_platforms` had **no RLS** (world-writable) | RLS enabled |
| High | Admin = one shared secret typed into the browser | JWT + `user_roles` check, server-side, rank rules, audit-logged |
| Medium | Public endpoints (inquiries, registrations, creator apply, EFT, Paystack) had no rate limit | DB-backed IP limiter |
| Medium | Social URLs stored unvalidated (`javascript:` risk) | `https://`-only in API + DB `CHECK` + render-time check |
| Bug | **Tournament pages were broken**: hub file was named `tournament.html`, all 43 links/Paystack callback use `tournaments.html`; the detail page (`tournament.html?id=`) and its init call didn't exist | Hub renamed to `tournaments.html`; real detail page created |
| Bug | Folder `supbase/` (docs say `supabase/`); relative-URL sitemap/robots (invalid) | Renamed; generated dynamically |
| Bug | Signup `username` metadata ignored; `?next=` never honoured | Trigger reads it (safe on collisions); safe redirect added |
| **Not changed** | `api/tournaments.js` sets `approval_status: 'approved'` for everyone (both ternary branches identical), so any creator can publish a *paid* tournament whose fees go to NXT's account | Left as-is — it's a business decision. Recommend an approval step for paid events. |

## 3. Preserved
Branding/tokens/fonts, all existing pages and flows, Paystack/EFT/Resend integrations, audit log, fixtures/standings,
creator application pipeline, `data.js` static content. Existing code was edited only where a bug/security issue required it.

## 4. Added (Priority 1 MVP)
- **Auth:** forgot/reset password page, change password, resend verification, sign out everywhere, config-driven OAuth buttons,
  safe `?next=`. Settings: profile, avatar/banner upload (Storage, 2 MB, jpg/png/webp, per-user folder), privacy, notifications.
- **Roles:** gamer/creator/team/community/business/organiser/moderator/admin/superadmin; `has_role/is_admin/is_staff`; enforced in
  RLS, RPCs and APIs. Team/community roles are granted automatically when you create one.
- **Profiles** (`profile.html`): stats per game, XP/level, achievements, teams, communities, recent matches, socials, follow /
  message / challenge / report / block. Creator badge + platforms shown for approved creators.
- **Discover & search:** global categorised search; directories for creators, gamers, competitive players, teams, communities, games
  with game/country filters.
- **Follow system** + notifications. **Communities** (create, join, posts, announcements, members, roles, rules, leaderboard, manage,
  delete). **Teams** (create, invite by username, accept/decline, roster roles, remove, leave, edit, delete).
- **Ranked 1v1 matches** (separate from tournaments): challenge → accept → schedule → submit result (+ evidence link) → opponent confirms
  or disputes → staff resolve. Confirmed results update stats, Elo-style rating, streaks, XP, achievements.
  Anti-farming: max 3 rated games per pair and 20 per player per 24 h; XP pays once per event.
- **Leaderboards:** overall (XP), per game (rating), country, community, team, tournament standings.
- **Notifications** (unread/read, realtime, bell badge). **Messaging** (1:1, message requests, DM privacy, block, report, read receipts;
  schema is participant-based so groups can be added).
- **Game pages** (database-driven). **Reports/moderation:** report users/messages/posts/communities/teams/tournaments, staff queue,
  notes, status, assignment, remove-content / suspend-community, audit history.
- **Admin console:** KPIs from real tables, reports queue, disputed matches, user search / suspend / ban (also bans the auth user) /
  verify / grant & revoke roles, plus the existing payments and creator-application tools.
- **Mobile:** app-style bottom tab bar (Home, Discover, Tournaments, Matches, Profile), bell in header; desktop nav updated.
- **SEO/a11y/ops:** dynamic sitemap + robots (absolute URLs, private pages disallowed), canonical/OG/Twitter + JSON-LD on profiles,
  security headers, skip link, focus states, labelled forms, `<dialog>` confirmations, loading/empty/error states, `noindex` on private pages.

## 5. Database changes (`supabase/hardening.sql`, `supabase/platform-v3.sql`)
New tables: `follows, blocks, communities, community_members, community_posts, teams, team_members, challenges, player_stats, user_xp,
xp_events, achievements, user_achievements, user_settings, conversations, conversation_participants, messages, reports, report_actions,
rate_limits`. New view `community_directory`. New columns on `profiles`: `banner_url, social_links, is_verified`. Extended role and
`account_status` constraints. ~45 SQL functions (all mutations are `SECURITY DEFINER` RPCs with explicit `EXECUTE` grants).
Storage bucket `media`. I added only tables the shipped UI actually uses.

## 6. Requires external credentials / setup
Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), Paystack (`PAYSTACK_SECRET_KEY`), Resend (`RESEND_API_KEY`), EFT bank
variables (unchanged). Optional: Google/Discord/Twitch OAuth (enable in Supabase, then list in `js/config.js`). Turn on **Confirm email**
and add `/reset-password.html` to Supabase redirect URLs. `NXT_ADMIN_KEY` is obsolete.

## 7. Not built (be aware)
Clips & video; live streaming (Twitch/YouTube) integration — admin shows "not configured" rather than a fake number; events calendar;
news CMS; creator analytics + media-kit portfolio; sponsor/business marketplace; shop improvements (shop is still "coming soon");
seasonal leaderboards; team registration for tournaments and team tournament history; evidence is a link, not an upload;
Xbox/PlayStation/Steam sign-in (no native Supabase provider); MFA; email/push delivery of notifications; group chat;
organiser tools beyond what the creator dashboard already had.
Other limits: pages are client-rendered, so SEO is weaker than SSR (Google executes JS; other crawlers may not);
no Content-Security-Policy yet (existing pages use inline scripts); rate limiter fails *open* if the DB is unreachable;
profile/avatar images are hot-linkable public URLs; existing creator pages still read `data.js`, not the database.

## 8. Run it
```bash
# Supabase SQL editor, in order (staging first):
#   schema.sql → platform-v2.sql → fixtures.sql → hardening.sql → platform-v3.sql
npm i -g vercel && vercel dev          # static site + /api functions locally
pip install playwright && playwright install chromium && python tests/smoke.py   # UI smoke test (stubbed backend)
```
Grant yourself admin after first sign-up:
`INSERT INTO public.user_roles (user_id, role) VALUES ('<your-uuid>', 'admin') ON CONFLICT DO NOTHING;`

## 9. Recommended next steps
1. Run both SQL files in staging; fix whatever Postgres rejects; write pgTAP/SQL tests for RLS (anon cannot read emails or write
   registrations; user A cannot read B's challenges/messages; suspended users blocked).
2. Add an approval step for paid creator tournaments. 3. Clips (Storage + transcoding via Mux/Cloudflare Stream) and Twitch/YouTube
live-status polling. 4. Events + news (admin CMS). 5. Creator analytics + media kit, then sponsor campaigns/applications.
6. SSR/prerender public profiles, communities and tournaments for SEO. 7. CSP after moving inline scripts out. 8. Seasons, team
tournament registration, email notifications.
