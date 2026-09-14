import { Module } from '@nestjs/common';

/**
 * E11 · Peer review & mentor — docs/PRD.md §7 E11
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: PR-01, PR-02.
 *
 * Identitas penulis DIHILANGKAN DI SERIALIZER, bukan hanya disembunyikan di UI
 * (PR-2). Mentor hanya melihat squad yang mentor_id-nya dirinya (PR-7) —
 * itu cek KEPEMILIKAN di service, bukan guard.
 */
@Module({})
export class MentorModule {}
