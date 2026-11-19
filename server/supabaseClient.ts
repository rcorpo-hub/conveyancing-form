import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
// Server-only key: the new "secret" key (sb_secret_...) or the legacy service_role key.
// The anon key is a last resort — with server-only RLS it cannot write anything.
const serverKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseKey = serverKey || process.env.SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
    supabaseUrl.startsWith('http') &&
    supabaseKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseKey.includes('eyJhbGciOi...') &&
    !supabaseKey.includes('your_key_here')
  );
}

export function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  if (isSupabaseConfigured()) {
    try {
      if (!serverKey) {
        console.warn('⚠️ [SUPABASE] Only SUPABASE_ANON_KEY is set. Database rules allow server-only access, so set SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in .env.');
      }
      supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      console.log('✅ [SUPABASE] Connected successfully to:', supabaseUrl);
      return supabase;
    } catch (err) {
      console.error('❌ [SUPABASE] Error creating client:', err);
      return null;
    }
  }
  return null;
}

// In-memory fallback if Supabase keys are pending configuration
const localIntakesFallback: any[] = [];
const localAuditLogsFallback: any[] = [];

/**
 * Next sequential matter reference, e.g. RK-2026-0001, RK-2026-0002.
 * Starts from 0001 for each year and increments sequentially.
 */
export async function getNextMatterReference(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `RK-${year}-`;
  const client = getSupabase();

  if (client) {
    try {
      const { data, error } = await client
        .from('conveyancing_intakes')
        .select('matter_reference')
        .like('matter_reference', `${prefix}%`)
        .order('matter_reference', { ascending: false })
        .limit(20);

      if (!error && data && data.length > 0) {
        const seqNums = data
          .map(r => parseInt(String(r.matter_reference || '').slice(prefix.length), 10))
          .filter(n => !isNaN(n) && n > 0);

        if (seqNums.length > 0) {
          const maxNum = Math.max(...seqNums);
          return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
        }
      }
      return `${prefix}0001`;
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE] Could not query latest matter reference:', err.message);
    }
  }

  // Fallback for local in-memory store
  return newMatterReference();
}

/** Synchronous matter reference generator starting from 0001. */
export function newMatterReference(): string {
  const year = new Date().getFullYear();
  const prefix = `RK-${year}-`;
  const localNums = localIntakesFallback
    .filter(i => typeof i.matter_reference === 'string' && i.matter_reference.startsWith(prefix))
    .map(i => parseInt(i.matter_reference.slice(prefix.length), 10))
    .filter(n => !isNaN(n) && n > 0);

  const nextLocal = localNums.length > 0 ? Math.max(...localNums) + 1 : 1;
  return `${prefix}${String(nextLocal).padStart(4, '0')}`;
}

export async function saveIntakeToSupabase(intake: {
  session_id?: string | null;
  matter_reference: string;
  role: string;
  party_count: number;
  primary_name: string;
  primary_email: string;
  primary_phone: string;
  parties: any[];
  property: any;
  finance: any;
  stamp_duty: any;
  id_documents: any[];
  ownership_type?: string | null;
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_email?: string | null;
  broker_company?: string | null;
  how_did_you_hear?: string | null;
  signature_data?: string | null;
  phone_country_code?: string | null;
  [key: string]: any;
}) {
  const client = getSupabase();
  if (client) {
    try {
      let row: Record<string, any> = { ...intake };
      for (let attempt = 0; attempt < 6; attempt++) {
        const { data, error } = await client
          .from('conveyancing_intakes')
          .insert([row])
          .select()
          .single();

        if (!error) {
          console.log('⚡ [SUPABASE] Intake inserted successfully. ID:', data.id);
          return data;
        }
        // Reference already used by an earlier matter — draw a new one
        if (error.code === '23505' && String(error.message).includes('matter_reference')) {
          row = { ...row, matter_reference: await getNextMatterReference() };
          continue;
        }
        // A session that only exists in the local fallback cannot be linked (or the
        // session_id column has not been added yet) — keep the intake without the link
        if ('session_id' in row) {
          console.warn('⚠️ [SUPABASE] Could not link intake to its form session, saving without the link:', error.message);
          const { session_id: _unlinked, ...withoutLink } = row;
          row = withoutLink;
          continue;
        }
        console.error('❌ [SUPABASE INSERT ERROR]:', error.message);
        throw error;
      }
      throw new Error('Could not insert intake after several attempts.');
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE] Falling back to local storage due to error:', err.message);
    }
  } else {
    console.log('ℹ️ [SUPABASE] Keys not yet provided in .env — stored in local fallback store.');
  }

  // Local fallback
  const record = { id: 'local_' + Date.now(), ...intake, created_at: new Date().toISOString() };
  localIntakesFallback.push(record);
  return record;
}

export async function saveAuditLogToSupabase(log: {
  intake_id?: string;
  matter_reference: string;
  session_id: string;
  user_name: string;
  user_phone: string;
  user_email: string;
  browser: string;
  operating_system: string;
  device_type: string;
  user_agent: string;
  ip_address: string;
  screen_resolution: string;
  timezone: string;
  language: string;
  referrer: string;
  cookie_payload: any;
}) {
  const client = getSupabase();
  if (client) {
    try {
      const { data, error } = await client
        .from('client_audit_logs')
        .insert([log])
        .select()
        .single();

      if (error) {
        console.error('❌ [SUPABASE AUDIT LOG ERROR]:', error.message);
      } else {
        console.log('🔍 [SUPABASE] Audit & Cookie telemetry logged. ID:', data.id);
        return data;
      }
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE] Audit log fallback:', err.message);
    }
  }

  localAuditLogsFallback.push({ id: 'local_audit_' + Date.now(), ...log, created_at: new Date().toISOString() });
}

// ─── Document uploads (Supabase Storage, with local-disk fallback) ────────────
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'intake-documents';
const localUploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads');

/** Read only files created by our upload endpoint, never arbitrary URLs or disk paths. */
export async function readUploadedFile(storagePath: string): Promise<Buffer> {
  const match = /^(local:|supabase:([^/]+)\/)(\d{4}\/\d{2}\/[0-9a-f-]{36}\.(?:pdf|jpg|png))$/i.exec(storagePath || '');
  if (!match) throw new Error('Invalid uploaded file path.');
  const key = match[3];
  let content: Buffer;
  if (match[1] === 'local:') {
    content = await fs.readFile(path.join(localUploadDir, key));
  } else {
    if (match[2] !== storageBucket) throw new Error('Unknown upload bucket.');
    const client = getSupabase();
    if (!client) throw new Error('Document storage is unavailable.');
    const { data, error } = await client.storage.from(storageBucket).download(key);
    if (error || !data) throw new Error('Could not read uploaded document.');
    content = Buffer.from(await data.arrayBuffer());
  }
  if (content.length > 5 * 1024 * 1024) throw new Error('Document exceeds the upload limit.');
  return content;
}

/** Stores an uploaded file and returns a storage path of the form `supabase:<bucket>/<key>` or `local:<key>`. */
export async function saveUploadedFile(key: string, data: Buffer, contentType: string): Promise<string> {
  const client = getSupabase();
  if (client) {
    try {
      const { error } = await client.storage.from(storageBucket).upload(key, data, { contentType, upsert: false });
      if (error) throw error;
      console.log('📎 [SUPABASE STORAGE] Uploaded:', key);
      return `supabase:${storageBucket}/${key}`;
    } catch (err: any) {
      console.warn('⚠️ [SUPABASE STORAGE] Falling back to local disk due to error:', err.message);
    }
  }

  const target = path.join(localUploadDir, key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  return `local:${key}`;
}
