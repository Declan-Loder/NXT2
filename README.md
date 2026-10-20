# NXT — Creator Community

A static, multi-page community website for NXT: a South African creator network connecting creators, gaming communities, collaboration opportunities and brand partners.

## Pages
- `index.html` — home and community introduction
- `creators.html` and `creator.html?id=...` — creator roster and individual profile pages
- `creator-login.html` / `creator-dashboard.html` — Supabase email/password authentication and protected session landing
- `collab.html` — collaboration page (form → `/api/inquiries`)
- `sponsors.html` — brand/sponsorship page (form → `/api/inquiries`)
- `tournaments.html` — standings (`data.js`) and Supabase tournament listings/registration
- `shop.html` / `checkout.html` — cart and checkout UI (PayFast not live yet)

## Deployment
Upload the contents of this folder to the GitHub repository connected to Vercel. Keep the root `index.html` at repository root. Vercel serves static files and the `/api/*` serverless functions.

### Required Vercel environment variables
| Variable | Purpose |
|----------|---------|
| `RESEND_API_KEY` | Sends collab + sponsor form emails via Resend |
| `TEST_EMAIL_SECRET` | Optional. Protects `/api/test-email` |

After setting `RESEND_API_KEY`, redeploy. Until a custom domain is verified in Resend, the API uses `onboarding@resend.dev` (Resend test sender).

## What works out of the box
- Static pages, navigation, cart (localStorage), scroll animations
- Creator profiles (hardcoded in `app.js` → `NXT_CREATORS`)
- Tournament group standings from `data.js`
- Collab + sponsor forms post JSON to `/api/inquiries` (needs Resend key)

## What still needs configuration (will not fully work until done)

1. **Resend email**  
   Set `RESEND_API_KEY` in Vercel. Verify a sending domain for production (replace `onboarding@resend.dev` in `api/inquiries.js` when ready).

2. **Supabase Auth (creator login / dashboard)**  
   - Confirm URL + anon key in `app.js` match your project  
   - Auth → enable Email provider  
   - Auth → URL config: production Site URL + redirect URLs  
   - Dashboard only confirms session; editable profiles need a `creator_profiles` table + RLS (not built yet)

3. **Supabase tournaments**  
   Tables expected by `app.js`:
   - `tournaments` (id, name, format, status, …)
   - `registrations` (tournament_id, player_name, gamertag, platform)  
   With RLS policies that allow public read on open tournaments and insert on registrations. Without these tables, live tournament cards/registration fail gracefully.

4. **PayFast checkout**  
   Browser-side merchant keys were removed on purpose. Checkout shows a notice until a trusted serverless payment endpoint creates the signature and verifies ITNs. Do not put merchant key or passphrase in `app.js`.

5. **Netlify forms**  
   Removed. The site deploys on Vercel; forms use `/api/inquiries` instead.

## Motion and accessibility
Scroll reveal animations use IntersectionObserver and respect `prefers-reduced-motion`.
