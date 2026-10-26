import { ReviewQueueScreen } from '@/components/review-queue-screen';
import { SquadScreen } from '@/components/squad-screen';

/**
 * /squad — layar squad & papan mingguan (Q-05), lalu antrean review (PR-03)
 * di bawahnya: "squad/ anggota, leaderboard, antrean review" (CLAUDE.md).
 * Antrean tetap tampil walau pengguna belum punya squad — reviewer tanpa
 * squad justru melihat semua attempt yang menunggu (queueFor, PR-01).
 */
export default function Page() {
  return (
    <>
      <SquadScreen />
      <ReviewQueueScreen />
    </>
  );
}
