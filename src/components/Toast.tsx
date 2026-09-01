'use client';

import { createContext, useCallback, useContext, useState } from 'react';

interface Toast {
  id: number;
  message: string;
  variant: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  push: (message: string, variant?: Toast['variant']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, variant: Toast['variant'] = 'info') => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`card px-4 py-3 text-sm shadow-lg ${
              t.variant === 'success'
                ? 'border-emerald-400/50 text-emerald-600 dark:text-emerald-400'
                : t.variant === 'error'
                  ? 'border-red-400/50 text-red-600 dark:text-red-400'
                  : ''
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
