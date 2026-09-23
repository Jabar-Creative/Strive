// Barrel modul `admin`. SATU-SATUNYA pintu masuk dari modul lain —
// aturan lint `no-restricted-imports` menolak impor menembus ke file di dalam.
export * from './admin.module';
export * from './user-role.service';
export * from './admin-users.controller';
export * from './integrations-health.service';
export * from './admin-integrations.controller';
