// Exchanges a LINE ID token (from LIFF) for a Supabase session.
// Flow: verify the token with LINE → find or create the user → mint a one-time magic-link
// token → the app calls supabase.auth.verifyOtp({ type: 'magiclink', token_hash }).
//
// Secrets (supabase secrets set ...):
//   LINE_CHANNEL_ID   — the LINE Login channel that owns the LIFF app
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const channelId = Deno.env.get('LINE_CHANNEL_ID');
  if (!channelId) return json({ error: 'line_not_configured' }, 500);

  const { idToken } = await req.json().catch(() => ({}));
  if (!idToken) return json({ error: 'id_token_required' }, 400);

  const verify = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!verify.ok) return json({ error: 'line_token_invalid' }, 401);
  const line = await verify.json() as { sub: string; name?: string; picture?: string };

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // LINE does not always share an email, so each LINE account gets a stable internal address.
  const email = `line_${line.sub.toLowerCase()}@line.invalid`;
  const meta = { name: line.name ?? 'สมาชิก', picture: line.picture ?? null, line_user_id: line.sub };

  const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
  if (created.error && !/already/i.test(created.error.message)) {
    return json({ error: 'create_user_failed' }, 500);
  }

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error || !link.data.properties?.hashed_token) return json({ error: 'link_failed' }, 500);

  // keep LINE picture fresh; never overwrite a name the member typed themselves
  await admin.from('profiles').update({ line_user_id: line.sub, avatar_url: line.picture ?? null })
    .eq('id', link.data.user.id);

  return json({ token_hash: link.data.properties.hashed_token });
});
