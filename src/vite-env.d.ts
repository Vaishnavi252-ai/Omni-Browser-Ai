/// <reference types="vite/client" />

declare global {
  const chrome: any;

  interface Window {
    __APP_ENV__?: string;
  }
}

export {};
