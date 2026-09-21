import clsx from 'clsx';
import premierLeagueLogo from '../../assets/brand/premier-league-logo.png';
import lionOutline from '../../assets/brand/leon-contorno.png';

/** Logo oficial de la Premier League proporcionado en los assets (proporciones originales). */
export function BrandLogo({ className }: { className?: string }) {
  return <img src={premierLeagueLogo} alt="Premier League" draggable={false} className={clsx('w-auto select-none object-contain', className)} />;
}

/** Marca compacta para la barra de navegación: león en contorno sobre el degradado de marca. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl bg-[image:var(--gradient-cta)] shadow-cta', className)}>
      <img src={lionOutline} alt="" draggable={false} className="h-6 w-auto brightness-0 invert" />
    </span>
  );
}
