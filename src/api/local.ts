import axios from 'axios';

const local = axios.create({ baseURL: '', timeout: 120_000 });

/** Stream a remote asset through the server's SSRF-allowlisted proxy and
 *  return it as a Blob. `filename` is only used by the proxy to set
 *  Content-Disposition; the client ignores it. */
export async function downloadAssetBlob(url: string, filename: string): Promise<Blob> {
  const { data } = await local.post(
    '/local-api/download-asset',
    { url, filename },
    { responseType: 'blob' },
  );
  return data as Blob;
}
