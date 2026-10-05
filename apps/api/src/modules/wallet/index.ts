// Barrel modul `wallet`. SATU-SATUNYA pintu masuk dari modul lain —
// aturan lint `no-restricted-imports` menolak impor menembus ke file di dalam.
export * from './wallet.module';
export * from './coin-ledger.service';
export * from './coin-ledger.types';
export * from './insufficient-coins.error';
export * from './wallet.service';
export * from './wallet.controller';
