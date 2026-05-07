const baseUrl = import.meta.env.BASE_URL || '/';

export function buildPublicAssetUrl(path: string): string {
  return `${baseUrl}${path.replace(/^\/+/, '')}`;
}
