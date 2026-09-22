import { BadRequestException, Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';

import { CurrentUserId, Roles, RolesGuard, SessionGuard } from '../../common/guards';
import { type AttemptResult, AttemptsService } from './attempts.service';
import type { JawabanClient } from './grading.service';

/** Bentuk body `POST /attempts` — `createAttemptRequestSchema` (F-08). */
interface AttemptBody {
  lesson_id?: unknown;
  answers?: unknown;
  duration_ms?: unknown;
}

/** LE-1 mengunci 3–5 kartu per lesson, jadi satu attempt tidak pernah lebih. */
const MAX_ANSWERS = 5;

/**
 * `POST /attempts` — PRD §10.3 (⚡), item `L-03`.
 *
 * Superadmin DITOLAK: mengerjakan lesson adalah aktivitas pengguna, dan akun
 * panel admin yang ikut mengumpulkan koin adalah akun yang angkanya tidak bisa
 * dipercaya di laporan mana pun.
 */
@UseGuards(SessionGuard, RolesGuard)
@Roles('student', 'mentor')
@Controller('attempts')
export class SubmitAttemptController {
  constructor(private readonly attempts: AttemptsService) {}

  @Post()
  async submit(
    @CurrentUserId() userId: string,
    @Body() body: AttemptBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AttemptResult> {
    // LE-8: WAJIB, bukan opsional. Ditolak DI SINI supaya service tidak pernah
    // menerima `undefined` yang lalu tersimpan sebagai NULL — dan
    // `idempotency_key UNIQUE` tidak menjaga apa pun terhadap NULL.
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Header Idempotency-Key wajib diisi',
          details: { header: 'Idempotency-Key' },
        },
      });
    }

    const lessonId = body?.lesson_id;
    const answers = body?.answers;
    const durationMs = body?.duration_ms;

    if (typeof lessonId !== 'string' || lessonId.length === 0) {
      throw badan('lesson_id');
    }
    if (!Array.isArray(answers) || answers.length === 0 || answers.length > MAX_ANSWERS) {
      throw badan('answers');
    }
    if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs < 0) {
      throw badan('duration_ms');
    }
    for (const a of answers) {
      const ok =
        typeof a === 'object' &&
        a !== null &&
        typeof (a as JawabanClient).card_id === 'string' &&
        (typeof (a as JawabanClient).answer === 'string' ||
          typeof (a as JawabanClient).answer === 'boolean');
      if (!ok) throw badan('answers[]');
    }

    return this.attempts.submit({
      userId,
      lessonId,
      answers: answers as JawabanClient[],
      durationMs,
      idempotencyKey,
    });
  }
}

function badan(field: string): BadRequestException {
  return new BadRequestException({
    error: { code: 'VALIDATION_ERROR', message: `${field} tidak valid`, details: { field } },
  });
}
