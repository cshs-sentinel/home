/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_SCHOOL_LAT?: string;
  readonly VITE_SCHOOL_LON?: string;
  readonly VITE_SCHOOL_PLACE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
