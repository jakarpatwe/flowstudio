# Studio Booking — notes for Claude Code

Thai fitness-studio booking system. Members use a LIFF web app inside LINE; staff use `/admin`.
Stack: Vite + React 18 + TypeScript, Supabase (Postgres, Auth, Realtime, one Edge Function), Netlify.

## Rules that matter
- **Business rules live in SQL functions** (`supabase/migrations/*_functions.sql`). The app never writes
  bookings, credits, sales or waitlist rows directly — it calls RPCs (`book_session`, `cancel_booking`,
  `pos_checkout`, …). RLS blocks direct writes to those tables. Keep it that way.
- Functions raise short error codes (`session_full`, `insufficient_credits`). Add a Thai sentence for every
  new code in `src/lib/errors.ts`.
- Schema changes = a **new** migration file with a later timestamp. Never edit an applied migration.
- After any SQL change run `npm run test:db` (local Postgres) and add a case to
  `supabase/tests/booking_rules_test.sql` for new rules.
- Times are stored as timestamptz and shown in Asia/Bangkok (`src/lib/format.ts`).
- Credits: one wallet made of lots (`credit_lots`), spent soonest-expiring first; normal before VIP.
  VIP classes (`class_types.requires_vip`) accept VIP credits only.
- A room can have many layouts; a session picks one. Spots removed from a layout are parked at negative
  coordinates (never deleted if ever booked) — always filter `x >= 0` when drawing.
- Members cannot see other members' bookings. Live spot maps listen to `session_pulse`, not `bookings`.

## UI
- Copy is Thai, plain and specific; buttons say exactly what happens ("จองตำแหน่งนี้", not "ยืนยัน").
- Visual tokens are in `src/styles/app.css` (cobalt = equipment, pink = "you", maple = reformer).
  The room map is the one bold element; keep other screens quiet. No gradients, no emoji, no stock icons sets.

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` · `npm run test:db`
