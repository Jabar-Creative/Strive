import { SquadScreen } from '@/components/squad-screen';

/**
 * /squad — layar squad & papan mingguan (Q-05): identitas squad dari
 * GET /squads/me, papan disegarkan via WS `score.updated` dengan fallback
 * polling 30 detik (RT-5). Stub F-09 digantikan layar ini.
 */
export default function Page() {
  return <SquadScreen />;
}
