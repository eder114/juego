import { useState, type ReactNode } from 'react';
import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { ArrowDown, ArrowUp, Lock } from 'lucide-react';
import clsx from 'clsx';
import type { LineupEntry, Position } from '../types';
import { STATUS_META } from '../lib/format';
import { PlayerPhoto } from './sport';

export interface LineupState {
  formation: string;
  starters: number[];
  bench: number[];
  captainId: number | null;
  viceCaptainId: number | null;
}

interface PitchProps {
  entries: Map<number, LineupEntry>;
  state: LineupState;
  editable: boolean;
  showPoints: boolean;
  selectedId?: number | null;
  validTargets?: Set<number>;
  activeCaptainId?: number | null;
  onTokenClick?: (id: number) => void;
  onSwap?: (a: number, b: number) => void;
  benchExtra?: ReactNode;
}

const ROW_ORDER: Position[] = ['FWD', 'MID', 'DEF', 'GK'];

export function Pitch({ entries, state, editable, showPoints, selectedId, validTargets, activeCaptainId, onTokenClick, onSwap, benchExtra }: PitchProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }));
  const [dragging, setDragging] = useState<number | null>(null);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const a = Number(e.active.id);
    const b = e.over ? Number(e.over.id) : NaN;
    if (!Number.isNaN(b) && a !== b) onSwap?.(a, b);
  };

  const token = (id: number, bench = false) => {
    const entry = entries.get(id);
    if (!entry) return null;
    return (
      <Token
        key={id}
        entry={entry}
        bench={bench}
        editable={editable}
        showPoints={showPoints}
        isCaptain={state.captainId === id}
        isVice={state.viceCaptainId === id}
        captainActive={activeCaptainId === id}
        selected={selectedId === id}
        target={!!validTargets?.has(id)}
        onClick={() => onTokenClick?.(id)}
      />
    );
  };

  const rows = ROW_ORDER.map((pos) => state.starters.filter((id) => entries.get(id)?.player.position === pos));

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDragging(Number(e.active.id))} onDragCancel={() => setDragging(null)} onDragEnd={onDragEnd}>
      <div className="pitch-bg relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl">
        <svg className="pointer-events-none absolute inset-0 size-full opacity-[0.22]" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden>
          <g fill="none" stroke="white" strokeWidth="0.5">
            <rect x="3" y="3" width="94" height="124" />
            <line x1="3" y1="65" x2="97" y2="65" />
            <circle cx="50" cy="65" r="11" />
            <rect x="24" y="3" width="52" height="18" />
            <rect x="37" y="3" width="26" height="7" />
            <rect x="24" y="109" width="52" height="18" />
            <rect x="37" y="120" width="26" height="7" />
            <path d="M40 21 A11 11 0 0 0 60 21" />
            <path d="M40 109 A11 11 0 0 1 60 109" />
          </g>
        </svg>
        <div className="relative flex min-h-[440px] flex-col justify-around gap-2 px-1 py-5 sm:min-h-[560px] sm:px-4 sm:py-8">
          {rows.map((ids, i) => (
            <div key={ROW_ORDER[i]} className="flex items-start justify-evenly">
              {ids.map((id) => token(id))}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-white/[0.08] bg-ink-850/80 p-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="label">Banquillo · orden de sustitución</p>
          {benchExtra}
        </div>
        <div className="flex items-start justify-evenly gap-1">
          {state.bench.map((id, i) => (
            <div key={id} className="flex flex-col items-center">
              <span className="mb-1 text-[10px] font-bold text-slate-500">{i + 1}º</span>
              {token(id, true)}
            </div>
          ))}
          {state.bench.length === 0 && <p className="py-4 text-sm text-slate-500">Sin suplentes</p>}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>{dragging && entries.get(dragging) ? <TokenVisual entry={entries.get(dragging)!} showPoints={showPoints} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

interface TokenProps {
  entry: LineupEntry;
  bench: boolean;
  editable: boolean;
  showPoints: boolean;
  isCaptain: boolean;
  isVice: boolean;
  captainActive: boolean;
  selected: boolean;
  target: boolean;
  onClick: () => void;
}

function Token({ entry, editable, onClick, ...visual }: TokenProps) {
  const id = entry.player.id;
  const drag = useDraggable({ id, disabled: !editable || entry.locked });
  const drop = useDroppable({ id, disabled: !editable || entry.locked });
  return (
    <button
      type="button"
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      {...drag.listeners}
      {...drag.attributes}
      onClick={onClick}
      className={clsx('touch-manipulation rounded-2xl outline-none transition', drag.isDragging && 'opacity-30', drop.isOver && 'scale-110')}
      aria-label={entry.player.displayName}
    >
      <TokenVisual entry={entry} {...visual} />
    </button>
  );
}

function TokenVisual({ entry, showPoints, isCaptain, isVice, captainActive, selected, target, bench, dragging }: Partial<TokenProps> & { entry: LineupEntry; showPoints: boolean; dragging?: boolean }) {
  const p = entry.player;
  const fixture = entry.fixtures[0];
  const points = entry.points * Math.max(1, captainActive ? 2 : 1);
  const unavailable = p.status !== 'AVAILABLE';
  return (
    <div className={clsx('flex w-[62px] flex-col items-center sm:w-[92px]', dragging && 'scale-110')}>
      <div className="relative">
        <div className={clsx('rounded-full p-0.5 transition', selected ? 'bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.25)]' : target ? 'animate-pulse bg-lime-glow' : 'bg-white/15', bench && !selected && !target && 'bg-white/10')}>
          <PlayerPhoto player={p} size={52} rounded="rounded-full" className="size-11! sm:size-16!" />
        </div>
        {isCaptain && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-gold font-display text-[12px] font-extrabold text-ink-950 ring-2 ring-ink-900 sm:size-6 sm:text-sm">C</span>}
        {isVice && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-slate-200 font-display text-[12px] font-extrabold text-ink-950 ring-2 ring-ink-900 sm:size-6 sm:text-sm">V</span>}
        {unavailable && <span className={clsx('absolute -left-0.5 top-0 size-3 rounded-full ring-2 ring-ink-900 sm:size-3.5', STATUS_META[p.status].dot)} title={STATUS_META[p.status].label} />}
        {entry.locked && (
          <span className="absolute -bottom-0.5 -left-1 grid size-4.5 place-items-center rounded-full bg-ink-900 text-slate-300 ring-1 ring-white/20" title="Bloqueado: su partido ya ha comenzado">
            <Lock className="size-2.5" />
          </span>
        )}
        {entry.autoSubIn && <ArrowUp className="absolute -bottom-1 -right-1 size-4 rounded-full bg-pitch-500 p-0.5 text-ink-950" />}
        {entry.autoSubOut && <ArrowDown className="absolute -bottom-1 -right-1 size-4 rounded-full bg-red-500 p-0.5 text-white" />}
      </div>
      <span className="mt-1 w-full truncate rounded-md bg-ink-950/85 px-1 py-0.5 text-center text-[10px] font-semibold text-white sm:text-xs">{p.displayName}</span>
      {showPoints ? (
        <span className={clsx('mt-0.5 min-w-8 rounded-md px-1.5 text-center font-display text-sm font-bold leading-5', points > 0 ? 'bg-pitch-500 text-ink-950' : points < 0 ? 'bg-red-500 text-white' : 'bg-white/80 text-ink-950')}>
          {entry.minutes > 0 || entry.points !== 0 ? points : fixture && fixture.status !== 'FINISHED' ? '–' : 0}
        </span>
      ) : (
        <span className="mt-0.5 w-full truncate rounded-md bg-white/85 px-1 text-center text-[9px] font-bold uppercase leading-4 text-ink-950 sm:text-[10px]">
          {fixture ? `${fixture.opponent.shortName} (${fixture.home ? 'L' : 'V'})${entry.fixtures.length > 1 ? ' +1' : ''}` : 'Sin partido'}
        </span>
      )}
    </div>
  );
}
