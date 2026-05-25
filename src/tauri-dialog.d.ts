declare module '@tauri-apps/api/dialog' {
  export interface OpenOptions {
    multiple?: boolean;
    directory?: boolean;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    title?: string;
  }
  export function open(opts?: OpenOptions): Promise<string | string[] | null>;
  export function save(opts?: any): Promise<string | null>;
}
