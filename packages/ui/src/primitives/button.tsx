import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

/**
 * Button — shadcn/ui resmi (struktur CVA + Radix Slot apa adanya), item F-07.
 * "Beli, jangan bangun" berlaku juga di sini: satu-satunya bagian yang
 * disesuaikan dari template shadcn standar adalah pemetaan warna varian ke
 * slot semantik Strive (lihat apps/web/app/globals.css) dan radius kontrol
 * (`rounded-ctl` — 999px di profil Student, 6px di Console — bukan
 * `rounded-md` bawaan shadcn, karena PRD §14.3 memang mengunci radius kontrol
 * per profil kepadatan, bukan nilai tetap).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ctl text-sm font-medium ring-offset-background transition-colors duration-base ease-base disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        // `border-line` ditambah eksplisit: token Strive tidak punya warna
        // "abu-abu netral" khusus, jadi `secondary` (surface) tanpa garis
        // nyaris tidak kelihatan di atas latar `paper` mode terang (keduanya
        // hampir putih). Ini bukan bagian dari template shadcn standar.
        secondary:
          'border border-line bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Render sebagai child langsung (mis. <Link>) alih-alih <button>, via Radix Slot. */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
