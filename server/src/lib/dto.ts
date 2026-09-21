import type { Prisma } from '@prisma/client';

export const clubLiteSelect = {
  id: true,
  name: true,
  shortName: true,
  commonName: true,
  crestUrl: true,
  primaryColor: true,
  secondaryColor: true,
  stadium: true,
} satisfies Prisma.ClubSelect;

export const playerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  position: true,
  clubId: true,
  birthDate: true,
  nationality: true,
  photoUrl: true,
  squadNumber: true,
  price: true,
  status: true,
  chanceOfPlaying: true,
  news: true,
  isActive: true,
  marketValue: true,
  rarity: true,
  club: { select: clubLiteSelect },
} satisfies Prisma.PlayerSelect;

export type PlayerRow = Prisma.PlayerGetPayload<{ select: typeof playerSelect }>;

export function ageFrom(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const m = now.getUTCMonth() - birthDate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

export const userPublicSelect = {
  id: true,
  managerName: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export function parseCrest(raw: string | null | undefined) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
