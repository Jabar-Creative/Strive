import type { ReactNode } from 'react';

export interface PageStubProps {
  /** Judul layar, sesuai daftar rute di CLAUDE.md. */
  title: string;
  /** ID item backlog yang akan mengisi layar ini. */
  item: string;
  /** Pemilik item — A atau B. */
  dev: 'A' | 'B';
  /** Bagian PRD yang mengatur perilaku layar ini. */
  prd: string;
  children?: ReactNode;
}

/**
 * Placeholder untuk 12 layar inti (item F-09).
 *
 * Sengaja tanpa komponen Strive dan tanpa warna token: `packages/ui` dan palet
 * adalah F-06/F-07 milik Dev B. Yang dibuktikan stub ini hanya satu hal —
 * rutenya ada dan bisa dinavigasi.
 */
export function PageStub({ title, item, dev, prd, children }: PageStubProps) {
  return (
    <section className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        stub · {item} · Dev {dev}
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Layar ini masih placeholder. Perilakunya diatur di <code>{prd}</code>; yang mengisinya
        adalah item <code>{item}</code> di <code>docs/BACKLOG.md</code>.
      </p>
      {children ? <div className="mt-6 text-sm">{children}</div> : null}
    </section>
  );
}
