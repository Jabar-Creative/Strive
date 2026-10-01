import { TrackList } from '@/components/track-list';

/**
 * /learn — layar daftar track & progres (L-05). Seluruh progres dihitung
 * server (LE-9); layar ini mengambil ulang setiap kali tab kembali terlihat
 * supaya lesson yang diselesaikan di tab lain langsung terlihat.
 */
export default function Page() {
  return <TrackList />;
}
