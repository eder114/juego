import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, badRequest } from './errors';
import { isProd } from '../config/env';

/** Valida y tipa datos de entrada con zod. Lanza 400 con el detalle de los campos. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    throw badRequest(fields[0]?.message ? `Datos inválidos: ${fields[0].field ? fields[0].field + ' — ' : ''}${fields[0].message}` : 'Datos inválidos', fields);
  }
  return result.data;
}

export const intParam = (value: unknown, name = 'id'): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Parámetro ${name} inválido`);
  return n;
};

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Ruta no encontrada: ${req.method} ${req.path}` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Datos inválidos', details: err.issues } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'Ya existe un registro con esos datos únicos' } });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Recurso no encontrado' } });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({ error: { code: 'CONFLICT', message: 'El registro está referenciado por otros datos' } });
      return;
    }
  }
  const e = err as { type?: string; status?: number; message?: string; name?: string; code?: string };
  if (e?.name === 'MulterError') {
    const message = e.code === 'LIMIT_FILE_SIZE' ? 'La imagen supera el tamaño máximo permitido (1 MB)' : 'Archivo no válido';
    res.status(400).json({ error: { code: 'BAD_REQUEST', message } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'JSON mal formado' } });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'El contenido enviado es demasiado grande' } });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: isProd ? 'Error interno del servidor' : (e?.message ?? 'Error interno') },
  });
}
