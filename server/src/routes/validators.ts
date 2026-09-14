import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(72, 'La contraseña no puede superar 72 caracteres')
  .regex(/[A-Za-z]/, 'La contraseña debe incluir al menos una letra')
  .regex(/\d/, 'La contraseña debe incluir al menos un número');

export const emailSchema = z.string().trim().toLowerCase().email('Email inválido').max(120);
export const managerNameSchema = z
  .string()
  .trim()
  .min(3, 'El nombre de mánager debe tener al menos 3 caracteres')
  .max(30, 'Máximo 30 caracteres')
  .regex(/^[\p{L}\p{N} _.-]+$/u, 'Solo letras, números, espacios, puntos y guiones');
export const teamNameSchema = z.string().trim().min(3, 'El nombre del equipo debe tener al menos 3 caracteres').max(30);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const crestSchema = z
  .object({
    shape: z.enum(['shield', 'round', 'classic', 'diamond']).default('shield'),
    pattern: z.enum(['plain', 'stripes', 'hoops', 'sash', 'half', 'chevron']).default('plain'),
    primary: hex.default('#16a34a'),
    secondary: hex.default('#0f172a'),
    initials: z.string().trim().max(3).default(''),
  })
  .strict();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export const statLineSchema = z.object({
  playerId: z.number().int().positive(),
  minutes: z.number().int().min(0).max(130),
  goals: z.number().int().min(0).max(10).default(0),
  assists: z.number().int().min(0).max(10).default(0),
  cleanSheet: z.boolean().optional(),
  goalsConceded: z.number().int().min(0).max(20).optional(),
  ownGoals: z.number().int().min(0).max(5).default(0),
  penaltiesSaved: z.number().int().min(0).max(5).default(0),
  penaltiesMissed: z.number().int().min(0).max(5).default(0),
  yellowCards: z.number().int().min(0).max(2).default(0),
  redCards: z.number().int().min(0).max(1).default(0),
  saves: z.number().int().min(0).max(30).default(0),
  bonus: z.number().int().min(0).max(3).default(0),
});
