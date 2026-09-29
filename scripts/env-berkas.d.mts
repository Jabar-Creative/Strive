/** Akar repo, dihitung dari letak `env-berkas.mjs`. */
export declare const AKAR: string;
/** Mengurai isi `.env` menjadi objek. Tanpa ekspansi variabel. */
export declare function uraiEnv(isi: string): Record<string, string>;
/** Menyalin `.env` ke `process.env` tanpa menimpa yang sudah ada. */
export declare function muatEnv(akar?: string): Record<string, string>;
