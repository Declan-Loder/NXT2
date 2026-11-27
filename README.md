# NXT — Creator Community

A static, multi-page community website for NXT: a South African creator network connecting creators, gaming communities, collaboration opportunities and brand partners.

## Pages
- `index.html` — home and community introduction
- `creators.html` and `creator.html?id=...` — creator roster and individual profile pages
- `creator-login.html` / `creator-dashboard.html` — Supabase email/password authentication and protected session landing
- `collab.html` — collaboration page (form → `/api/inquiries`)
- `sponsors.html` — brand/sponsorship page (form → `/api/inquiries`)
- `tournaments.html` — standings (`data.js`) and Supabase tournament listings/registration
- `player-login.html` / `player-dashboard.html` — player auth + my tournaments
- `admin.html` — admin console (overview, reports, disputes, users, payments, creator applications); role-based sign-in
- `shop.html` / `checkout.html` — NXT Supply **Coming Soon** (merch video + product preview; cart locked until drop)

## Deployment
Upload the contents of this folder to the GitHub repository connected to Vercel. Keep the root `index.html` at repository root. Vercel serves static files and the `/api/*` serverless functions.

### Required Vercel environment variables

| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Sends collab + sponsor form emails via Resend |
| `TEST_EMAIL_SECRET` | Optional. Protects `/api/test-email` |
| `PAYSTACK_SECRET_KEY` | Paystack secret key (card payments) |
| `SUPABASE_URL` | Supabase project URL (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB + storage access — **never** put in frontend |
| `NXT_BANK_NAME` | EFT display: bank name |
| `NXT_BANK_ACCOUNT_NAME` | EFT display: account name |
| `NXT_BANK_ACCOUNT_NUMBER` | EFT display: account number |
| `NXT_BANK_BRANCH_CODE` | EFT display: branch code |

After setting keys, redeploy. Until a custom domain is verified in Resend, the API uses `onboarding@resend.dev`.

---

## Tournament registration & payments (Stage 1)

### Schema
Run `supabase/schema.sql` in the Supabase SQL Editor. It creates / extends:

- `tournaments`
- `registrations` (unique `registration_id`, `payment_reference`, full player fields, payment status machine)
- `payments`
- `payment_proofs`
- `payment_audit_log`
- Storage bucket `payment-proofs` (private, 5 MB, jpeg/png/webp/pdf)

### API endpoints

| Route | Purpose |
|-------|---------|
| `POST /api/registrations` | Create registration + unique IDs. Returns bank details when method is `eft`. |
| `POST /api/payments-eft` | Upload EFT proof (base64), set status `pending_verification` |
| `POST /api/paystack-initialize` | Start Paystack checkout (existing) |
| `POST /api/paystack-verify` | Verify card payment server-side; mark registration `paid` |
| `POST /api/admin-payments` | Admin list / approve / reject / note (Bearer token of an admin) |
| `POST /api/admin-users` | Search / suspend / ban / role / verify (staff; rank rules enforced server-side) |
| `GET /sitemap.xml`, `GET /robots.txt` | Generated from the request host and database |

### Payment statuses
`awaiting_payment` → `payment_submitted` / `pending_verification` → `paid` | `payment_rejected` | `cancelled` | `refunded`

- **Free** tournaments → immediately `paid`
- **EFT** → player pays with unique reference, uploads proof → admin approves
- **Card (Paystack)** → only marked `paid` after server-side verify / webhook confirmation

### Security notes
- Service role key and Paystack secret stay on Vercel only
- Card numbers never touch NXT servers
- Players cannot change their own payment status
- Admin actions are audited in `payment_audit_log`
- NXT is not represented as a registered company; EFT remains fully usable

### Frontend (Stage 2+)
Registration form UX, checkout panels, and admin dashboard UI are next. Backend is ready for those screens.

---

## What works out of the box
- Static pages, navigation, cart (localStorage), scroll animations
- Creator profiles (hardcoded in `app.js` → `NXT_CREATORS`)
- Tournament group standings from `data.js`
- Collab + sponsor forms post JSON to `/api/inquiries` (needs Resend key)
- Paystack initialize + verify routes
- Registration / EFT / admin API scaffolding (needs schema + env vars)

## What still needs configuration

1. **Resend email** — set `RESEND_API_KEY`; verify a sending domain for production.
2. **Supabase Auth** — URL + anon key in `app.js`; enable Email provider; set Site URL + redirects.
3. **Supabase schema** — run `supabase/schema.sql`; set service role + bank env vars.
4. **Paystack** — set `PAYSTACK_SECRET_KEY` for card path.
5. **Admin access** — grant yourself the `admin` role in `user_roles` (see DEPLOY.md), then sign in and open `/admin`.

## Motion and accessibility
Scroll reveal animations use IntersectionObserver and respect `prefers-reduced-motion`.


See **PLATFORM.md** for the full audit, schema order, and roadmap.

## Platform v3 pages
`discover`, `profile`, `communities`, `teams`, `games`, `leaderboards`, `challenges` (ranked 1v1), `messages`, `notifications`,
`settings`, `reset-password`, `tournament` (detail) and `tournaments` (hub). Shared client code lives in `js/`.
See **UPGRADE_REPORT.md** for what changed, what is untested, and what is still to build.
