import { MentorConsoleScreen } from '@/components/mentor-console-screen';

/**
 * /mentor — konsol mentor (PR-04, Dev B). `middleware.ts` sudah menjaga
 * gerbang peran sebelum halaman ini dirender (student → 403, belum login →
 * /login); superadmin lolos middleware dan API mengembalikan antrean kosong
 * (ia bukan mentor_id squad mana pun).
 */
export default function Page() {
  return <MentorConsoleScreen />;
}
