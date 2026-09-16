import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Token warna Strive (indigo-600, flame-500, coin-500, mint-500, rose-500,
 * ink-900/500, paper, surface, line), tipografi, dan dua profil kepadatan
 * Student/Console — item F-06, docs/PRD.md §14. MILIK Dev B: kalau perlu
 * token baru atau perubahan nilai, minta ke pemilik F-06, jangan menambah
 * sendiri di sini.
 *
 * Warna, radius (`--r-card`/`--r-ctl`), dan durasi (`--t-base`/`--t-cel`)
 * semuanya mengarah ke custom property CSS yang didefinisikan di
 * app/globals.css (nilai terang di `:root`, nilai gelap di `.dark`, nilai
 * per-profil-kepadatan di `[data-density]`) — BUKAN nilai literal di sini.
 * Ini pola yang sama dengan slot shadcn di atas (`hsl(var(--background))`
 * dst), supaya kelas Tailwind (`bg-indigo-600`, `rounded-card`, dst)
 * otomatis mengikuti mode dan profil tanpa perlu varian `dark:` manual.
 *
 * Slot semantik shadcn (primary/secondary/muted/accent/destructive/dst di
 * atas) SUDAH dipetakan ke token Strive — keputusan desain komponen item
 * F-07, lihat komentar lengkap di app/globals.css tepat di atas blok
 * `:root` shadcn. Nilai custom property-nya sekarang HEX (`var(--color-*)`),
 * bukan lagi triplet HSL shadcn default (`222.2 84% 4.9%`) — makanya setiap
 * slot di bawah dibungkus `var(--x)` polos, BUKAN `hsl(var(--x))` seperti
 * template shadcn standar (hsl() akan invalid kalau argumennya sudah berupa
 * string hex).
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        // `success` BUKAN slot bawaan shadcn — tambahan F-07 (docs/PRD.md
        // §14.1, mint-500 = "Benar, selesai, tervalidasi"). Lihat komentar
        // panjang di app/globals.css soal kenapa perlu `--ink-on-accent`
        // sebagai foreground-nya, bukan `paper`.
        success: {
          DEFAULT: 'var(--success)',
          foreground: 'var(--success-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },

        // ── Token Strive — docs/PRD.md §14.1 ──────────────────────────────
        indigo: { 600: 'var(--color-indigo-600)' },
        flame: { 500: 'var(--color-flame-500)' },
        coin: { 500: 'var(--color-coin-500)' },
        mint: { 500: 'var(--color-mint-500)' },
        rose: { 500: 'var(--color-rose-500)' },
        ink: { 900: 'var(--color-ink-900)', 500: 'var(--color-ink-500)' },
        paper: 'var(--color-paper)',
        surface: 'var(--color-surface)',
        line: 'var(--color-line)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // Radius Strive per profil kepadatan — docs/PRD.md §14.3.
        card: 'var(--r-card)',
        ctl: 'var(--r-ctl)',
      },
      // Tiga peran font Strive — docs/PRD.md §14.2. Variabel diisi next/font
      // di app/layout.tsx. Fallback stack dipilih agar tetap terbaca kalau
      // Google Fonts gagal dimuat.
      fontFamily: {
        display: ['var(--font-display)', 'Segoe UI', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'Segoe UI', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: [
          'var(--font-mono)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      // Enam peran tipografi Strive — docs/PRD.md §14.2. Ukuran, bobot, dan
      // letter-spacing SALIN PERSIS dari tabel PRD; line-height tidak
      // ditentukan PRD, jadi diisi nilai wajar (keputusan Dev B, dicatat di
      // laporan sesi F-06).
      fontSize: {
        display: ['40px', { lineHeight: '1.1', fontWeight: '800' }],
        title: ['24px', { lineHeight: '1.25', fontWeight: '700' }],
        body: ['15px', { lineHeight: '1.6', fontWeight: '400' }],
        caption: ['13px', { lineHeight: '1.5', fontWeight: '500' }],
        label: ['11px', { lineHeight: '1.4', letterSpacing: '0.1em', fontWeight: '500' }],
        data: ['14px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      // Gerak Strive — docs/PRD.md §14.3. `--t-base`/`--t-cel` di globals.css
      // adalah shorthand gabungan; di sini dipetakan sebagai pecahan
      // (duration terpisah dari easing) karena begitu cara Tailwind
      // mengekspos transitionDuration/transitionTimingFunction.
      transitionDuration: {
        base: 'var(--t-base-duration)',
        cel: 'var(--t-cel-duration)',
      },
      transitionTimingFunction: {
        base: 'var(--t-base-ease)',
      },
    },
  },
  plugins: [animate],
};

export default config;
