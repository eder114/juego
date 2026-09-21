import { createContext, useContext, useState, type ReactNode } from 'react';
import { LoadingBlock, Modal, Tabs } from '../ui';
import { formatBudget, usePublicConfig } from '../../hooks/usePublicConfig';
import { POSITION_PLURAL, POSITIONS } from '../../lib/format';

export type LegalTab = 'rules' | 'scoring' | 'privacy';

const LegalContext = createContext<(tab: LegalTab) => void>(() => undefined);

/** Abre el reglamento, la puntuación o la política de privacidad desde cualquier parte de la pantalla. */
export const useLegal = () => useContext(LegalContext);

export function LegalProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<LegalTab | null>(null);
  return (
    <LegalContext.Provider value={setTab}>
      {children}
      <Modal open={tab !== null} onClose={() => setTab(null)} title="Reglamento y privacidad" size="lg">
        {tab && <LegalContent tab={tab} onTab={setTab} />}
      </Modal>
    </LegalContext.Provider>
  );
}

const FORMATIONS = '3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2 y 5-4-1';

function LegalContent({ tab, onTab }: { tab: LegalTab; onTab: (t: LegalTab) => void }) {
  const { data: cfg, isLoading } = usePublicConfig();
  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={onTab}
        tabs={[
          { value: 'rules', label: 'Reglamento' },
          { value: 'scoring', label: 'Puntuación' },
          { value: 'privacy', label: 'Privacidad' },
        ]}
      />
      {isLoading || !cfg ? (
        <LoadingBlock />
      ) : tab === 'rules' ? (
        <ul className="list-disc space-y-2.5 pl-5 text-sm leading-relaxed text-slate-200 marker:text-pitch-400">
          <li>Empiezas la temporada {cfg.season} con un presupuesto de <b>{formatBudget(cfg.initialBudget)}</b>.</li>
          <li>
            Tu plantilla tiene <b>{cfg.squadSize} jugadores</b>: {POSITIONS.map((p) => `${cfg.squad[p]} ${POSITION_PLURAL[p].toLowerCase()}`).join(', ')}.
          </li>
          <li>Puedes tener como máximo <b>{cfg.maxPerClub} jugadores</b> del mismo club.</li>
          <li>Cada jornada alineas {cfg.starters} titulares en una formación permitida ({FORMATIONS}) y ordenas a tus suplentes.</li>
          <li>
            Tu capitán multiplica sus puntos ×{cfg.captainMultiplier}.
            {cfg.viceCaptainEnabled && ' Si no juega, el vicecapitán hereda el multiplicador.'}
          </li>
          {cfg.autoSubs && <li>Si un titular no juega ningún minuto, entra automáticamente el primer suplente válido respetando la formación.</li>}
          <li>
            {cfg.lockMode === 'PER_MATCH'
              ? 'Cada jugador queda bloqueado cuando empieza el partido de su club; los demás se pueden cambiar hasta su partido.'
              : 'La alineación queda bloqueada al cierre de la jornada.'}
          </li>
          <li>Los puntos salen de las estadísticas reales de cada partido de la Premier League, y los precios cambian tras cada jornada según rendimiento y demanda.</li>
        </ul>
      ) : tab === 'scoring' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {POSITIONS.map((pos) => (
            <div key={pos} className="glass-card overflow-hidden">
              <p className="border-b border-white/[0.08] px-4 py-2.5 font-display text-lg font-bold uppercase text-white">{POSITION_PLURAL[pos]}</p>
              <ul className="divide-y divide-white/[0.05]">
                {cfg.scoring
                  .filter((r) => r.position === pos)
                  .map((r) => (
                    <li key={r.action} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                      <span className="text-slate-300">
                        {r.label}
                        {r.mode === 'per_unit' && r.threshold > 1 && <span className="text-slate-500"> (cada {r.threshold})</span>}
                      </span>
                      <span className={r.points >= 0 ? 'font-bold text-pitch-400' : 'font-bold text-red-300'}>
                        {r.points > 0 ? `+${r.points}` : r.points}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3 text-sm leading-relaxed text-slate-200">
          <p>Para jugar guardamos tu email, tu nombre de mánager, tu contraseña cifrada (nunca en texto plano), tu club favorito y, si la subes, tu foto de perfil.</p>
          <p>Con esos datos gestionamos tu cuenta, tu equipo, tus ligas y tus notificaciones. Tu nombre de mánager, tu equipo y tus puntos son visibles para los demás participantes de tus ligas y en la clasificación global.</p>
          <p>No compartimos tus datos con terceros. Puedes cambiar tus datos desde tu perfil y pedir al administrador la eliminación de tu cuenta.</p>
        </div>
      )}
    </div>
  );
}
