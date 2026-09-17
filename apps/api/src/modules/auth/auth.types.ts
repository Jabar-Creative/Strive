import type { betterAuth } from 'better-auth';

/** Tipe instance Better-Auth yang dipakai repo ini. */
export type StriveAuth = ReturnType<typeof betterAuth>;

export interface AuthOptions {
  connectionString: string;
  secret: string;
  baseURL?: string;
}

/** Konteks sesi yang dicatat ke `audit_log` — sisa satu-satunya dari AU-5. */
export interface SessionContext {
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
}

/** Token injeksi NestJS untuk instance Better-Auth. */
export const AUTH = Symbol('AUTH');
