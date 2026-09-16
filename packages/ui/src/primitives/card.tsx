import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Card — shadcn/ui resmi (struktur 6-bagian apa adanya), item F-07.
 *
 * Perbedaan sengaja dari template shadcn standar:
 * 1. `rounded-card` (18px Student / 8px Console — PRD §14.3), bukan
 *    `rounded-lg` bawaan shadcn yang memakai `--radius` generik.
 * 2. TIDAK ada `shadow-sm` bawaan. PRD §14.3: "Bayangan hanya pada kartu
 *    yang bisa di-swipe" (Student) / "hanya pada popover & menu" (Console).
 *    Card generik ini dipakai di banyak konteks yang BUKAN kartu swipe (mis.
 *    pembungkus form, ringkasan), jadi bayangan tidak boleh jadi default di
 *    level primitif. `LessonCard` (packages/ui/src/student) yang memang
 *    swipeable menambahkan shadow-nya sendiri secara eksplisit.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card border border-line bg-card text-card-foreground', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-display text-title leading-none text-ink-900', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  // `text-muted-foreground` = ink-500. Sengaja hanya untuk deskripsi kartu —
  // teks sekunder/non-esensial, konteks yang diizinkan F-06 report untuk
  // ink-500 walau kontrasnya di bawah AA 4.5:1 di mode terang (lihat
  // docs/reports/F-06/README.md). JANGAN pakai CardTitle/CardContent utama
  // untuk teks yang harus terbaca sebagai isi penting.
  <p ref={ref} className={cn('text-caption text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-3 p-6 pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
