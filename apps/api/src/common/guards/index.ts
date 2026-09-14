// Barrel guards. Diisi oleh A-02 (Dev A): JwtGuard, RolesGuard, @Roles.
//
// Ingat batas yang paling mudah salah (docs/PRD.md §2.5, CLAUDE.md):
// guard menjawab "peran ini boleh masuk rute ini?" — BUKAN "sumber daya ini
// milik siapa?". Kepemilikan dicek di service. Superadmin TIDAK otomatis lolos
// rute student.
export {};
