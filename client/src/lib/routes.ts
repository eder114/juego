import type { Me } from '../types';

/** Página inicial de cada usuario: su panel, el panel admin, o el onboarding si aún no tiene equipo. */
export const homeFor = (user: Me) => (user.team ? '/dashboard' : user.role === 'ADMIN' ? '/admin' : '/register');
