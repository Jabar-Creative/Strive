'use client';

import { useState } from 'react';

import { CvBuilderScreen } from '@/components/cv-builder-screen';
import { PromptLabScreen } from '@/components/prompt-lab-screen';

/**
 * /career — dua alat dalam satu halaman lewat tab (AI-07, wireframe p06):
 * ATS CV builder (asinkron, polling) dan Prompt Lab (sinkron). KEDUA panel
 * tetap terpasang dan hanya disembunyikan, bukan dilepas — job CV yang sedang
 * dipoll tidak boleh berhenti hanya karena pengguna mengintip tab sebelah.
 */
export default function Page() {
  const [tab, setTab] = useState<'cv' | 'lab'>('cv');

  return (
    <div>
      <div className="sticky top-0 z-10 mx-auto w-full max-w-sm bg-background/95 px-4 pt-2">
        <div
          role="tablist"
          aria-label="Alat karir"
          className="flex gap-2 rounded-card border border-line p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'cv'}
            className={`flex-1 rounded-ctl px-3 py-1.5 text-sm ${
              tab === 'cv' ? 'bg-primary text-primary-foreground' : 'hover:bg-line'
            }`}
            onClick={() => setTab('cv')}
            data-testid="tab-cv"
          >
            ATS CV
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lab'}
            className={`flex-1 rounded-ctl px-3 py-1.5 text-sm ${
              tab === 'lab' ? 'bg-primary text-primary-foreground' : 'hover:bg-line'
            }`}
            onClick={() => setTab('lab')}
            data-testid="tab-lab"
          >
            Prompt Lab
          </button>
        </div>
      </div>

      <div role="tabpanel" hidden={tab !== 'cv'}>
        <CvBuilderScreen />
      </div>
      <div role="tabpanel" hidden={tab !== 'lab'}>
        <PromptLabScreen />
      </div>
    </div>
  );
}
