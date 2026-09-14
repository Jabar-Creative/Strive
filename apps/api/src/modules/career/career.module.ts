import { Module } from '@nestjs/common';

/**
 * E8 · ATS CV + E13 · Prompt Lab — docs/PRD.md §7 E8, E13
 *
 * KERANGKA KOSONG. Controller & service menyusul di item: AI-06.
 *
 * PROXY TIPIS ke AI service. Node TIDAK PERNAH memanggil LLM langsung —
 * selalu lewat `ai_jobs` + AI service (CLAUDE.md aturan 8).
 * Skor ATS DETERMINISTIK, tanpa LLM (CV-6).
 */
@Module({})
export class CareerModule {}
