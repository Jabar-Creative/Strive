import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

/**
 * Badge — shadcn/ui resmi (struktur CVA apa adanya), item F-07. Basis visual
 * untuk `Pill` (packages/ui/src/primitives/pill.tsx) dan komponen domain
 * Student (StreakChip/CoinPill/LeagueBadge) yang butuh kontainer status kecil.
 *
 * `rounded-ctl` menggantikan `rounded-full` bawaan shadcn — nilainya SAMA
 * (999px di profil Student), tapi tetap ikut turun ke 6px di profil Console
 * kalau suatu saat Badge dipakai di layar mentor/admin.
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-ctl border px-2.5 py-0.5 text-caption font-semibold transition-colors duration-base ease-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'border-line text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
