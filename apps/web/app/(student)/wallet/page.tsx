import { WalletScreen } from '@/components/wallet-screen';

/**
 * Layar dompet — C-03. Seluruh isi layar butuh cookie sesi ke API, jadi
 * layarnya komponen klien; halaman ini Server Component tipis pola L-04.
 */
export default function Page() {
  return <WalletScreen />;
}
