// Barrel realtime — RT-01 (Dev A): WS gateway + adapter Redis pub/sub.
//
// Aturan yang menentukan bentuknya (docs/PRD.md §7 E15, §11):
//   - WS ada DI DALAM proses Core API, bukan service terpisah (§8.2).
//   - Redis pub/sub sebagai adapter sejak hari pertama, meski awalnya satu
//     instance — supaya multi-instance tidak butuh perubahan arsitektur.
//   - v0.1 satu kanal saja: `squad:{id}` event `score.updated`.
//   - Event dikirim OUTBOX WORKER setelah commit, bukan dari request handler.
//   - Klien wajib punya fallback polling 30 detik. Mematikan WS server tidak
//     boleh membuat layar mana pun kosong atau error.
export * from './realtime.module';
export * from './realtime.emitter';
export * from './redis-io.adapter';
export * from './squad.gateway';
