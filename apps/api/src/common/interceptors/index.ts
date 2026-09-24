// Barrel interceptor. Diisi oleh C-01/L-03 (Dev A): IdempotencyInterceptor.
//
// Setiap POST bertanda ⚡ di docs/PRD.md §10.3 wajib `Idempotency-Key`.
// Request ulang mengembalikan respons PERTAMA, bukan efek kedua.
export * from './rate-limit.interceptor';
