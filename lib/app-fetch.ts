export const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";

export function appFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return fetch(`${appBasePath}${input}`, init);
  }
  return fetch(input, init);
}

export function appAsset(path: string): string {
  return `${appBasePath}${path.startsWith("/") ? path : `/${path}`}`;
}
