// Storage gateway for the Vercel deployment (see server/src/cloud.ts).
// No shared secret: the caller proves who it is with the identity token
// Vercel issues to every function of the project (OIDC). The token's
// signature is checked against Vercel's published keys, and it must belong
// to this team, the kks project and the production environment.
// Deployed with verify_jwt off because the token is Vercel's, not Supabase's.

import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5.9.6';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TEAM_SLUG = 'itais-projects-603c58d7';
const TEAM_ID = 'team_Jw27U4jTQuFt07RXg5GQd0y8';
const PROJECT_ID = 'prj_DmKG343Z44xA1dJHbNqmVNjxIS1c';
const ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;

const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// tokens already verified by this instance, until they expire
const verified = new Map<string, number>();

async function authorized(req: Request): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const until = verified.get(token);
  if (until && until > Date.now()) return true;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: `https://vercel.com/${TEAM_SLUG}` });
    const ok = payload.owner_id === TEAM_ID && payload.project_id === PROJECT_ID && payload.environment === 'production';
    if (ok && payload.exp) {
      if (verified.size > 100) verified.clear();
      verified.set(token, payload.exp * 1000);
    }
    return ok;
  } catch {
    return false;
  }
}

type Args = Record<string, unknown>;
const ops: Record<string, (a: Args) => Promise<unknown>> = {
  async kks_version() {
    const { data, error } = await db.from('kks_state').select('version').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data ? Number(data.version) : null;
  },
  async kks_load() {
    const { data, error } = await db.from('kks_state').select('version, data').eq('id', 1);
    if (error) throw error;
    return data ?? [];
  },
  // saves only if nobody saved since p_expected (0: the first save)
  async kks_save({ p_expected, p_data }) {
    const expected = Number(p_expected);
    if (expected === 0) {
      const { data, error } = await db.from('kks_state').upsert({ id: 1, version: 1, data: String(p_data) }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
      if (error) throw error;
      return (data ?? []).length === 1;
    }
    const { data, error } = await db
      .from('kks_state')
      .update({ version: expected + 1, data: String(p_data), updated_at: new Date().toISOString() })
      .eq('id', 1)
      .eq('version', expected)
      .select('id');
    if (error) throw error;
    return (data ?? []).length === 1;
  },
  async kks_put_file({ p_name, p_data }) {
    const { error } = await db.from('kks_files').upsert({ name: String(p_name), data: String(p_data), size: String(p_data).length }, { onConflict: 'name' });
    if (error) throw error;
    return null;
  },
  async kks_get_file({ p_name }) {
    const { data, error } = await db.from('kks_files').select('data').eq('name', String(p_name)).maybeSingle();
    if (error) throw error;
    return data?.data || null;
  },
  // the row stays as a tombstone; its contents are released
  async kks_delete_file({ p_name }) {
    const { error } = await db.from('kks_files').update({ data: '', size: 0 }).eq('name', String(p_name));
    if (error) throw error;
    return null;
  },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { message: 'method not allowed' });
  const t0 = performance.now();
  if (!(await authorized(req))) return json(401, { message: 'unauthorized' });
  const t1 = performance.now();
  let body: { fn?: string; args?: Args };
  try {
    body = await req.json();
  } catch {
    return json(400, { message: 'bad request' });
  }
  const op = body.fn ? ops[body.fn] : undefined;
  if (!op) return json(404, { message: 'unknown operation' });
  try {
    const out = await op(body.args ?? {});
    console.log(`${body.fn} auth=${Math.round(t1 - t0)}ms op=${Math.round(performance.now() - t1)}ms`);
    return json(200, out);
  } catch (e) {
    console.error(body.fn, e);
    return json(500, { message: 'storage error' });
  }
});
