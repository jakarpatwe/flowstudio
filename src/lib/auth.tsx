import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { supabase, configured } from './supabase';
import type { Branch, Profile } from './types';

const LIFF_ID = (import.meta.env.VITE_LIFF_ID as string | undefined) || '';

interface AuthState {
  ready: boolean;
  session: AuthSession | null;
  profile: Profile | null;
  branch: Branch | null;
  /** True while signing in through LINE so screens can show a quiet loading state. */
  lineSigningIn: boolean;
  lineError: string | null;
  usesLine: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export const isStaffRole = (p: Profile | null) => !!p && ['staff', 'manager', 'owner'].includes(p.role);
export const isManagerRole = (p: Profile | null) => !!p && ['manager', 'owner'].includes(p.role);

async function signInWithLine(): Promise<void> {
  const { default: liff } = await import('@line/liff');
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: window.location.href });
    return new Promise(() => {}); // page is navigating away
  }
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('line_token_invalid');
  const { data, error } = await supabase.functions.invoke('line-auth', { body: { idToken } });
  if (error || !data?.token_hash) throw new Error(data?.error ?? 'line_token_invalid');
  const { error: otpError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: data.token_hash });
  if (otpError) throw new Error(otpError.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [lineSigningIn, setLineSigningIn] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: AuthSession | null) => {
    if (!s) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    setProfile(data as Profile | null);
    const branchQuery = data?.branch_id
      ? supabase.from('branches').select('*').eq('id', data.branch_id).maybeSingle()
      : supabase.from('branches').select('*').order('created_at').limit(1).maybeSingle();
    const { data: b } = await branchQuery;
    setBranch(b as Branch | null);
  }, []);

  useEffect(() => {
    if (!configured) { setReady(true); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      let s = data.session;
      const devMode = new URLSearchParams(window.location.search).has('dev') || window.location.pathname.startsWith('/admin');
      if (!s && LIFF_ID && !devMode) {
        setLineSigningIn(true);
        try {
          await signInWithLine();
          s = (await supabase.auth.getSession()).data.session;
        } catch (e) {
          setLineError(e instanceof Error ? e.message : String(e));
        } finally {
          setLineSigningIn(false);
        }
      }
      if (cancelled) return;
      setSession(s);
      await loadProfile(s);
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      void loadProfile(s);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value: AuthState = {
    ready, session, profile, branch, lineSigningIn, lineError, usesLine: Boolean(LIFF_ID),
    refreshProfile: () => loadProfile(session),
    signOut: async () => { await supabase.auth.signOut(); setProfile(null); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
