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
 * atas) SENGAJA belum dipetakan ke token Strive — itu keputusan desain
 * komponen, lingkup F-07.
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
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
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
