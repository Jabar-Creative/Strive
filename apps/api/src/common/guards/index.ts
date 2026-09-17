// Barrel guards — diisi oleh A-02.
//
// Batas yang paling mudah salah (docs/PRD.md §2.5, CLAUDE.md): guard menjawab
// "peran ini boleh masuk rute ini?" — BUKAN "sumber daya ini milik siapa?".
// Kepemilikan dicek di service. Superadmin TIDAK otomatis lolos rute student.
export * from './access-matrix';
export * from './current-user.decorator';
export * from './roles.decorator';
export * from './roles.guard';
export * from './session.guard';
