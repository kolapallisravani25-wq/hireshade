export interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
}

export interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<E = string>(pattern: string, options?: { eager?: boolean }): Record<string, E>;
}

declare namespace NodeJS {
  interface ProcessEnv {
    DB_HOST?: string;
    DB_PORT?: string;
    DB_USER?: string;
    DB_PASSWORD?: string;
    DB_DATABASE?: string;
    DB_SSL?: string;
    KOTTSTER_SECRET_KEY?: string;
    KOTTSTER_API_TOKEN?: string;
    JWT_SECRET_SALT?: string;
    ROOT_USERNAME?: string;
    ROOT_PASSWORD?: string;
    OPEN_ROUTER_MANAGEMENT_KEY?: string;
  }
}
