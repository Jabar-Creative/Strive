import * as React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '../primitives/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../primitives/card';

export type LessonCardVariant = 'multiple_choice' | 'swipe_binary';

export interface LessonCardProps {
  variant: LessonCardVariant;
  /** Judul singkat kartu (mis. nama modul/topik). */
  title: string;
  /** Pertanyaan/instruksi kartu. */
  prompt: string;
  /**
   * Konten spesifik varian: daftar opsi untuk `multiple_choice` (dirender
   * oleh pemanggil — kunci jawaban TIDAK PERNAH lewat komponen ini, sesuai
   * CLAUDE.md aturan #9 "Penilaian selalu di server, serializer membuang
   * kunci jawaban"), diabaikan untuk `swipe_binary`.
   */
  children?: React.ReactNode;
  /** Hanya dipakai `swipe_binary`. Default label "Benar"/"Salah". */
  correctLabel?: string;
  incorrectLabel?: string;
  onCorrect?: () => void;
  onIncorrect?: () => void;
  className?: string;
}

/**
 * LessonCard — docs/PRD.md §14.4, radius 18px + bayangan (kartu yang bisa
 * di-swipe, satu-satunya jenis kartu di UI kit ini yang memakai shadow —
 * lihat komentar `Card` primitif soal kenapa shadow tidak jadi default di
 * sana).
 *
 * `swipe_binary` WAJIB punya alternatif tombol selain gestur swipe —
 * docs/PRD.md §14.5: "Kartu swipe punya alternatif tombol (swipe bukan
 * satu-satunya cara)". Implementasi gestur swipe penuh ada di scope L-04
 * (belum dikerjakan di sini); dua tombol di bawah ini SUDAH memenuhi syarat
 * aksesibilitas itu sekarang, terlepas dari kapan gestur-nya menyusul.
 *
 * Tombol "Benar"/"Salah" SOLID (bukan outline+teks berwarna) — dihitung
 * ulang, `rose-500`/`mint-500` sebagai WARNA TEKS di atas latar terang gagal
 * AA (~3,9:1 dan ~2,5:1, lihat komentar pill.tsx). Sebagai LATAR SOLID
 * dengan teks `--destructive-foreground`/`--success-foreground` (dipatok ke
 * ink-900 mode terang, lihat globals.css), keduanya lolos AA di kedua mode.
 */
export function LessonCard({
  variant,
  title,
  prompt,
  children,
  correctLabel = 'Benar',
  incorrectLabel = 'Salah',
  onCorrect,
  onIncorrect,
  className,
}: LessonCardProps) {
  return (
    <Card className={cn('rounded-card shadow-md', className)}>
      <CardHeader>
        <p className="font-mono text-label uppercase text-ink-500">
          {variant === 'multiple_choice' ? 'Pilihan ganda' : 'Swipe benar/salah'}
        </p>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-body text-ink-900">{prompt}</p>
        {variant === 'multiple_choice' ? children : null}
      </CardContent>
      {variant === 'swipe_binary' ? (
        <CardFooter className="grid grid-cols-2 gap-3">
          <Button type="button" variant="destructive" onClick={onIncorrect}>
            <XCircle aria-hidden="true" />
            {incorrectLabel}
          </Button>
          <Button
            type="button"
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={onCorrect}
          >
            <CheckCircle2 aria-hidden="true" />
            {correctLabel}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
