import { rows, rpc, supabase } from './supabase';
import type { Availability, SessionRow, Wallet } from './types';

export const SESSION_SELECT = '*, class_types(*), rooms(*), instructors(*), layouts(*)';

export async function loadSessions(from: Date, to: Date, branchId?: string | null): Promise<SessionRow[]> {
  let q = supabase.from('sessions').select(SESSION_SELECT)
    .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
    .eq('status', 'scheduled').order('starts_at');
  if (branchId) q = q.eq('branch_id', branchId);
  return rows<SessionRow>(q);
}

export async function loadAvailability(from: Date, to: Date, branchId?: string | null) {
  const list = await rpc<Availability[]>('session_availability', {
    p_from: from.toISOString(), p_to: to.toISOString(), p_branch_id: branchId ?? null,
  });
  return new Map(list.map((a) => [a.session_id, a]));
}

export const loadWallet = (memberId?: string) =>
  rpc<Wallet>('member_wallet', memberId ? { p_member_id: memberId } : {});
