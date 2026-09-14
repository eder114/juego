import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pf_install_dismissed';
const DISMISS_DAYS = 14;

function wasDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86400000;
  } catch {
    return false;
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Invita a instalar la app en el teléfono (Android/Chrome con un toque; iPhone con instrucciones). */
export function InstallPrompt({ className = '' }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone() || wasDismissed());
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isMobile = window.matchMedia('(max-width: 1023px)').matches;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* sin almacenamiento */
    }
    setHidden(true);
  };

  if (hidden || !isMobile || (!deferred && !isIOS)) return null;

  return (
    <div className={`animate-fade-up rounded-2xl border border-pitch-500/30 bg-ink-800/95 p-3.5 shadow-2xl backdrop-blur ${className}`} role="dialog" aria-label="Instalar aplicación">
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="size-11 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Instala Premier Fantasy</p>
          {deferred ? (
            <p className="text-xs text-slate-400">Úsala como una app: pantalla completa y acceso desde tu inicio.</p>
          ) : (
            <p className="text-xs text-slate-400">
              Toca <Share className="inline size-3.5 align-text-bottom text-sky-400" /> <b className="text-slate-200">Compartir</b> y luego{' '}
              <SquarePlus className="inline size-3.5 align-text-bottom" /> <b className="text-slate-200">Añadir a pantalla de inicio</b>.
            </p>
          )}
        </div>
        <button onClick={dismiss} className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:text-white" aria-label="Cerrar">
          <X className="size-4" />
        </button>
      </div>
      {deferred && (
        <button
          onClick={async () => {
            await deferred.prompt();
            const { outcome } = await deferred.userChoice;
            if (outcome === 'accepted') setHidden(true);
            setDeferred(null);
          }}
          className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pitch-500 text-sm font-bold text-ink-950 active:scale-[0.98]"
        >
          <Download className="size-4" /> Instalar app
        </button>
      )}
    </div>
  );
}
