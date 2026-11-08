'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, createApiClient } from '@/lib/api-client';
import {
  LABEL_SEVERITY,
  MAKS_BERKAS_BYTE,
  bacaBerkas,
  cvGagal,
  cvSiap,
  generateGagal,
  isiProfil,
  isiTargetRole,
  jobDiterima,
  mulaiCv,
  mulaiGenerate,
  pesanGalatCv,
  pilihSumber,
  pollingBerhenti,
  statusTiba,
  temuanDari,
  ulangiPercobaan,
  type CvState,
} from '@/lib/cv-builder';

/**
 * Layar ATS CV — AI-07 (Dev B), PRD §7 E8 + wireframe p06. Asinkron penuh:
 * `202 {job_id}` lalu polling sampai hasil tiba (CV-2). Semua pesan galat
 * bercabang pada `error.code`, bukan `message` (§10.1); skor dan temuan
 * hanya dirender dari server (aturan keras 9 — tidak ada hitungan skor di
 * klien). Temuan dirender TEKS POLOS, satu item per baris.
 */

/** Polling tiap 2,5 dtk, maksimum 5 menit — job mengendap disapu server 30 menit. */
const SELANG_POLL_MS = 2500;
const MAKS_POLL = 120;

export function CvBuilderScreen() {
  const api = useMemo(
    () => createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001' }),
    [],
  );

  const [state, setState] = useState<CvState>(mulaiCv);
  const kunciRef = useRef<string | null>(null);

  useEffect(() => {
    const batal = new AbortController();
    Promise.all([
      api.getActivePricing({ signal: batal.signal }),
      api.getMe({ signal: batal.signal }),
    ])
      .then(([harga, aku]) => setState((s) => cvSiap(s, harga.cv_cost_coins, aku.display_name)))
      .catch(() => setState(cvGagal('NETWORK')));
    return () => batal.abort();
  }, [api]);

  // ── Polling job: hidup hanya saat menunggu dengan jobId di tangan ──
  useEffect(() => {
    if (state.faseJob !== 'menunggu' || !state.jobId) return;
    // Narrowing `state.jobId` tidak bertahan masuk closure interval —
    // ditangkap sekali di sini.
    const jobId = state.jobId;
    let nyala = true;
    let percobaan = 0;
    const timer = setInterval(async () => {
      if (!nyala) return;
      percobaan += 1;
      if (percobaan > MAKS_POLL) {
        nyala = false;
        clearInterval(timer);
        setState((s) => pollingBerhenti(s));
        return;
      }
      try {
        const job = await api.cvJobStatus(jobId);
        if (!nyala) return;
        setState((s) => statusTiba(s, job));
        if (job.status === 'done' || job.status === 'failed') {
          nyala = false;
          clearInterval(timer);
        }
      } catch {
        // Galat jaringan sesaat diabaikan — polling berikutnya mencoba lagi.
        // Galat definitif (404 dsb.) akan terus terjadi dan berakhir di batas
        // percobaan; biarkan state "menunggu" tetap jujur, jangan setengah gagal.
      }
    }, SELANG_POLL_MS);
    return () => {
      nyala = false;
      clearInterval(timer);
    };
  }, [api, state.faseJob, state.jobId]);

  const pilihBerkas = useCallback(async (berkas: File | null) => {
    if (!berkas) return;
    if (berkas.size > MAKS_BERKAS_BYTE) {
      setState((s) => ({ ...bacaBerkas(s, null), galat: { code: 'FILE_TOO_LARGE' } }));
      return;
    }
    const base64 = await berkasKeBase64(berkas);
    setState((s) => bacaBerkas(s, { nama: berkas.name, base64 }));
  }, []);

  const generate = useCallback(() => {
    if (!kunciRef.current) kunciRef.current = crypto.randomUUID();
    setState((s) => mulaiGenerate(s));
    const body =
      state.sumber === 'upload'
        ? {
            target_role: state.targetRole.trim(),
            language: 'id' as const,
            source: 'upload' as const,
            document_base64: state.berkas?.base64 ?? '',
          }
        : {
            target_role: state.targetRole.trim(),
            language: 'id' as const,
            source: 'profile' as const,
            profile: {
              nama: state.profil.nama.trim(),
              ...(state.profil.headline.trim() ? { headline: state.profil.headline.trim() } : {}),
              ...(state.profil.ringkasan.trim()
                ? { ringkasan: state.profil.ringkasan.trim() }
                : {}),
              keterampilan: state.profil.keterampilan
                .split(',')
                .map((k) => k.trim())
                .filter((k) => k !== ''),
            },
          };
    api
      .generateCv(body, kunciRef.current)
      .then((res) => setState((s) => jobDiterima(s, res.job_id)))
      .catch((e: unknown) =>
        setState((s) => generateGagal(s, e instanceof ApiError ? e.code : 'NETWORK')),
      );
    // Kunci TIDAK di-nol-kan di finally: percobaan ini masih berjalan di
    // server. Kunci baru lahir lewat `ulangiPercobaan` (tombol coba lagi).
  }, [api, state.sumber, state.targetRole, state.berkas, state.profil]);

  const ulangi = useCallback(() => {
    kunciRef.current = crypto.randomUUID(); // percobaan baru = kunci baru (#245)
    setState((s) => ulangiPercobaan(s));
  }, []);

  if (state.fase === 'memuat') return <Pesan teks="Memuat CV Builder…" />;
  if (state.fase === 'gagal')
    return <Pesan teks="CV Builder gagal dimuat. Muat ulang halaman untuk mencoba lagi." />;

  const siapGenerate =
    state.targetRole.trim() !== '' &&
    (state.sumber === 'upload' ? state.berkas !== null : state.profil.nama.trim() !== '');

  const temuan = state.hasil ? temuanDari(state.hasil.ats_findings) : [];

  return (
    <div
      className="mx-auto flex w-full max-w-sm flex-col gap-3 px-4 pb-8 pt-2"
      data-testid="cv-builder"
    >
      <header>
        <p className="font-mono text-label uppercase text-ink-500">Karir · ATS CV</p>
        <p className="mt-1 text-sm text-ink-500">
          Skor ATS deterministik dari dokumen atau profilmu — {state.biaya ?? 400} koin per
          generate, kuota 10 run AI/hari (bergabung dengan Prompt Lab dan Mastery).
        </p>
      </header>

      <section className="rounded-card border border-line bg-background p-4">
        <fieldset>
          <legend className="text-sm font-medium">Sumber CV</legend>
          <div className="mt-2 flex flex-col gap-2">
            <label
              className="flex cursor-pointer items-start gap-2 rounded-ctl border border-line px-3 py-2 text-sm"
              data-testid="label-sumber-upload"
            >
              <input
                type="radio"
                name="sumber-cv"
                value="upload"
                className="mt-0.5"
                checked={state.sumber === 'upload'}
                onChange={() => setState((s) => pilihSumber(s, 'upload'))}
                data-testid="cv-sumber-upload"
              />
              <span>
                Unggah CV lama (PDF/DOCX, maks 8 MB)
                <span className="block text-label text-ink-500">
                  {state.berkas ? `Terpilih: ${state.berkas.nama}` : 'Belum ada berkas'}
                </span>
              </span>
            </label>
            <label
              className="flex cursor-pointer items-start gap-2 rounded-ctl border border-line px-3 py-2 text-sm"
              data-testid="label-sumber-profil"
            >
              <input
                type="radio"
                name="sumber-cv"
                value="profile"
                className="mt-0.5"
                checked={state.sumber === 'profile'}
                onChange={() => setState((s) => pilihSumber(s, 'profile'))}
                data-testid="cv-sumber-profil"
              />
              <span>Pakai profil Strive Academy</span>
            </label>
          </div>
        </fieldset>

        {state.sumber === 'upload' ? (
          <input
            type="file"
            accept=".pdf,.docx,application/pdf"
            className="mt-3 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm"
            onChange={(e) => void pilihBerkas(e.target.files?.[0] ?? null)}
            data-testid="cv-berkas"
          />
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div>
              <label className="text-sm font-medium" htmlFor="cv-nama">
                Nama lengkap
              </label>
              <input
                id="cv-nama"
                type="text"
                className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={200}
                value={state.profil.nama}
                onChange={(e) => setState((s) => isiProfil(s, 'nama', e.target.value))}
                data-testid="cv-nama"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="cv-headline">
                Headline <span className="font-normal text-ink-500">· opsional</span>
              </label>
              <input
                id="cv-headline"
                type="text"
                className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={200}
                value={state.profil.headline}
                onChange={(e) => setState((s) => isiProfil(s, 'headline', e.target.value))}
                data-testid="cv-headline"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="cv-ringkasan">
                Ringkasan singkat <span className="font-normal text-ink-500">· opsional</span>
              </label>
              <textarea
                id="cv-ringkasan"
                className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                rows={3}
                maxLength={2000}
                value={state.profil.ringkasan}
                onChange={(e) => setState((s) => isiProfil(s, 'ringkasan', e.target.value))}
                data-testid="cv-ringkasan"
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="cv-keterampilan">
                Keterampilan{' '}
                <span className="font-normal text-ink-500">· pisahkan dengan koma</span>
              </label>
              <input
                id="cv-keterampilan"
                type="text"
                className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="SQL, Python, Menulis riset"
                value={state.profil.keterampilan}
                onChange={(e) => setState((s) => isiProfil(s, 'keterampilan', e.target.value))}
                data-testid="cv-keterampilan"
              />
            </div>
          </div>
        )}

        <div className="mt-3">
          <label className="text-sm font-medium" htmlFor="cv-target-role">
            Target role
          </label>
          <input
            id="cv-target-role"
            type="text"
            className="mt-1 w-full rounded-ctl border border-line bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="mis. Data Analyst"
            maxLength={120}
            value={state.targetRole}
            onChange={(e) => setState((s) => isiTargetRole(s, e.target.value))}
            data-testid="cv-target-role"
          />
        </div>

        {state.galat ? (
          <div className="mt-2 text-sm text-flame-600" role="alert" data-testid="cv-galat">
            <p>{pesanGalatCv(state.galat.code, state.biaya)}</p>
            {state.galat.code === 'INSUFFICIENT_COINS' ? (
              <a
                className="mt-1 inline-block underline"
                href="/wallet"
                data-testid="tautan-isi-koin"
              >
                Isi koin
              </a>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="mt-3 rounded-ctl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={!siapGenerate || state.faseJob === 'menunggu'}
          onClick={generate}
          data-testid="tombol-generate"
        >
          {state.faseJob === 'menunggu'
            ? 'Sedang diproses…'
            : `Generate CV ATS (${state.biaya ?? 400} koin)`}
        </button>
      </section>

      {state.faseJob === 'menunggu' ? (
        <section
          className="rounded-card border border-line bg-background p-4"
          role="status"
          data-testid="cv-menunggu"
        >
          <p className="font-medium">Sedang diproses</p>
          <p className="mt-1 text-sm text-ink-500">
            {state.statusServer === 'running' ? 'Dikerjakan layanan AI' : 'Antre'} — status
            diperiksa otomatis sampai hasil tiba.
          </p>
        </section>
      ) : null}

      {state.faseJob === 'gagalJob' && state.galatJob ? (
        <section
          className="rounded-card border border-line bg-background p-4"
          role="alert"
          data-testid="cv-galat-job"
        >
          <p className="font-medium">Generate gagal</p>
          <p className="mt-1 text-sm text-flame-600">
            {pesanGalatCv(state.galatJob.code, state.biaya)}{' '}
            <span className="font-mono text-label text-ink-500">{state.galatJob.code}</span>
          </p>
          <button
            type="button"
            className="mt-3 rounded-ctl border border-line px-4 py-2 text-sm hover:bg-line"
            onClick={ulangi}
            data-testid="tombol-ulangi"
          >
            Buat percobaan baru
          </button>
        </section>
      ) : null}

      {state.faseJob === 'selesai' && state.hasil ? (
        <section
          className="rounded-card border border-line bg-background p-4"
          data-testid="cv-hasil"
        >
          <p className="font-medium">Skor ATS</p>
          <p className="mt-1 text-3xl font-medium">
            {state.hasil.ats_score ?? '-'}
            <span className="text-base font-normal text-ink-500">/100</span>
          </p>
          <p className="mt-1 text-label text-ink-500">
            deterministik — sama untuk dokumen yang sama
          </p>

          {temuan.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2" data-testid="cv-temuan">
              {temuan.map((t, i) => (
                <li
                  key={`${t.aturan}-${i}`}
                  className="rounded-ctl border border-line px-3 py-2 text-sm"
                  data-testid={`cv-temuan-${i}`}
                >
                  <span
                    className={
                      t.severity === 'error'
                        ? 'font-mono text-label uppercase text-flame-600'
                        : 'font-mono text-label uppercase text-ink-500'
                    }
                  >
                    {LABEL_SEVERITY[t.severity]}
                  </span>
                  <span className="ml-2">{t.pesan}</span>
                  {t.penalti > 0 ? <span className="ml-1 text-ink-500">(-{t.penalti})</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-500">Tidak ada temuan.</p>
          )}

          {state.hasil.pdf_url ? (
            <a
              className="mt-3 inline-block rounded-ctl border border-line px-4 py-2 text-sm hover:bg-line"
              href={state.hasil.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="cv-unduh"
            >
              Unduh PDF
            </a>
          ) : null}
          <p className="mt-2 text-label text-ink-500">
            Hasil CV satu kolom, tanpa tabel dan ikon — ramah parser ATS.
          </p>
        </section>
      ) : null}
    </div>
  );
}

function Pesan({ teks }: { teks: string }) {
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-10 text-center text-sm text-ink-500">
      {teks}
    </div>
  );
}

/** File → base64 tanpa prefiks data-URL (bentuk yang diminta `document_base64`). */
function berkasKeBase64(berkas: File): Promise<string> {
  return new Promise((selesai, gagal) => {
    const pembaca = new FileReader();
    pembaca.onerror = () => gagal(new Error('gagal membaca berkas'));
    pembaca.onload = () => {
      const hasil = String(pembaca.result ?? '');
      selesai(hasil.slice(hasil.indexOf(',') + 1));
    };
    pembaca.readAsDataURL(berkas);
  });
}
