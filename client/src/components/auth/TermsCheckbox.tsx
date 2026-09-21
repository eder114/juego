import { CheckboxField } from '../brand/forms';
import { useLegal } from './LegalModal';

export function TermsCheckbox({ checked, onChange, error }: { checked: boolean; onChange: (v: boolean) => void; error?: string }) {
  const openLegal = useLegal();
  return (
    <CheckboxField checked={checked} onChange={onChange} error={error} accessibleLabel="Acepto las Reglas del Torneo Fantasy y la Política de Privacidad">

      Acepto las{' '}
      <button type="button" onClick={() => openLegal('rules')} className="text-white/90 underline decoration-white/45 underline-offset-4 transition hover:text-white">
        Reglas del Torneo Fantasy
      </button>{' '}
      y la{' '}
      <button type="button" onClick={() => openLegal('privacy')} className="transition hover:text-white hover:underline hover:underline-offset-4">
        Política de Privacidad
      </button>
      .
    </CheckboxField>
  );
}
