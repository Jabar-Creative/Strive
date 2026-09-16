// Komponen profil kepadatan "Student" — item F-07 (Dev B). docs/PRD.md §14.4:
//   StreakChip     active · at_risk · frozen · broken — SUDAH ada di sini
//                  `broken` TIDAK PERNAH merah — streak putus itu kekecewaan,
//                  bukan kesalahan (SK-10).
//   CoinPill       saldo · delta positif · delta negatif, tabular-nums — SUDAH ada
//   LeagueBadge    bronze · silver · gold — SUDAH ada
//   LessonCard     multiple_choice · swipe_binary, radius 18px — SUDAH ada
//
// DI LUAR SCOPE F-07 (backlog lain, JANGAN dikerjakan di sini):
//   QuestProgress  0/3 · 1/3 · 2/3 · selesai
//   EmptyState     setiap daftar WAJIB punya
//   ErrorState     menampilkan `code`, bukan stack trace
export * from './streak-chip';
export * from './coin-pill';
export * from './league-badge';
export * from './lesson-card';
