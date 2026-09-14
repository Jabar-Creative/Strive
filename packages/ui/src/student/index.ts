// Komponen profil kepadatan "Student" — item F-07 (Dev B). docs/PRD.md §14.4:
//   StreakChip     active · at_risk · frozen · broken
//                  `broken` TIDAK PERNAH merah — streak putus itu kekecewaan,
//                  bukan kesalahan (SK-10).
//   CoinPill       saldo · delta positif · delta negatif, tabular-nums
//   LeagueBadge    bronze · silver · gold
//   LessonCard     multiple_choice · swipe_binary, radius 18px
//   QuestProgress  0/3 · 1/3 · 2/3 · selesai
//   EmptyState     setiap daftar WAJIB punya
//   ErrorState     menampilkan `code`, bukan stack trace
export {};
