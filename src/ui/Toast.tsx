import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'ok' | 'error';
const Ctx = createContext<(text: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; tone: Tone; id: number } | null>(null);
  const show = useCallback((text: string, tone: Tone = 'ok') => {
    const id = Date.now();
    setToast({ text, tone, id });
    window.setTimeout(() => setToast((t) => (t && t.id === id ? null : t)), tone === 'error' ? 5000 : 2800);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      <div className="toast-slot" aria-live="polite">
        {toast && <div className={`toast toast-${toast.tone}`} key={toast.id}>{toast.text}</div>}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
