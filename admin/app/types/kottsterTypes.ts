import { ComponentType, ReactNode } from 'react';

export interface PageProps {
  title: string;
  fullWidth?: boolean;
  children?: ReactNode;
}

export interface PageEntry {
  default: ComponentType;
}

export interface KottsterAppProps {
  pageEntries: Record<string, PageEntry>;
}

export interface VitePluginOptions {
  schema: Record<string, unknown>;
}

export interface AppSchema {
  id: string;
  meta: {
    name: string;
    icon?: string;
  };
  pages: Array<{
    id: string;
    type: string;
    title: string;
    hideInSidebar?: boolean;
  }>;
}

export interface AppOptions {
  schema: AppSchema;
  secretKey: string;
  kottsterApiToken: string;
  identityProvider: unknown;
}

export interface App {
  listen(): Promise<void>;
  defineCustomController<T extends Record<string, (...args: unknown[]) => unknown>>(
    controllers: T
  ): { [K in keyof T]: T[K] };
}

export interface SQLiteIdentityProviderOptions {
  fileName: string;
  passwordHashAlgorithm: string;
  jwtSecretSalt: string;
  rootUsername: string;
  rootPassword: string;
}

export interface EditorConfig {
  container: HTMLElement;
  height?: string;
  width?: string;
  storageManager?: boolean | Record<string, unknown>;
  plugins?: unknown[];
  pluginsOpts?: Record<string, Record<string, unknown>>;
  components?: string;
}

export interface Editor {
  getHtml(): string;
  getCss(): string;
  destroy(): void;
}

export interface TooltipProps<TValue extends number | string | Array<number | string>, TName extends number | string> {
  active?: boolean;
  payload?: Array<{
    name: TName;
    value: TValue;
    color: string;
  }>;
  label?: string;
}
