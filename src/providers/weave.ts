/**
 * Source provider for open-weave. Lists every enabled stream on the northbound
 * API and turns each placed, node-hosted output into an SRT source that
 * open-live dials (`?mode=caller`). Remote outputs (empty `node`) are
 * destinations weave dials out to itself, so they are not offered.
 */

import { requireEnv } from '../config.js';
import type { ProviderSource, SourceProvider } from './types.js';

export interface WeaveProviderOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface WeaveStream {
  name: string;
  enabled?: boolean;
}

interface WeaveEndpoint {
  node: string;
  host: string;
  port: number;
  url: string;
}

interface WeaveEndpoints {
  ingress: WeaveEndpoint;
  outputs: WeaveEndpoint[];
}

const DEFAULT_TIMEOUT_MS = 5000;

export function weaveProviderFromEnv(): SourceProvider {
  return createWeaveProvider({
    baseUrl: requireEnv('WEAVE_NORTHBOUND_URL'),
    token: requireEnv('WEAVE_NORTHBOUND_TOKEN'),
  });
}

export function createWeaveProvider(options: WeaveProviderOptions): SourceProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function get(path: string): Promise<Response> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${options.token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401) {
      throw new Error('open-weave northbound rejected WEAVE_NORTHBOUND_TOKEN (401)');
    }
    return res;
  }

  async function listStreams(): Promise<WeaveStream[]> {
    const res = await get('/v1/streams');
    if (!res.ok) throw new Error(`open-weave northbound GET /v1/streams failed with ${res.status}`);
    const body: unknown = await res.json();
    if (!Array.isArray(body)) throw new Error('open-weave northbound GET /v1/streams returned a non-array body');
    return body as WeaveStream[];
  }

  /** null when the stream is known but unplaced (503) or unknown (404). */
  async function getEndpoints(name: string): Promise<WeaveEndpoints | null> {
    const path = `/v1/streams/${encodeURIComponent(name)}/endpoints`;
    const res = await get(path);
    if (res.status === 404 || res.status === 503) return null;
    if (!res.ok) throw new Error(`open-weave northbound GET ${path} failed with ${res.status}`);
    return (await res.json()) as WeaveEndpoints;
  }

  return {
    id: 'weave',
    async list(): Promise<ProviderSource[]> {
      const streams = (await listStreams()).filter((s) => s.enabled !== false);
      const perStream = await Promise.all(streams.map(async (stream) => {
        const endpoints = await getEndpoints(stream.name);
        return endpoints ? toSources(stream.name, endpoints.outputs) : [];
      }));
      return perStream.flat();
    },
  };
}

export function toSources(streamName: string, outputs: WeaveEndpoint[]): ProviderSource[] {
  const hosted = outputs
    .map((output, index) => ({ output, index }))
    .filter(({ output }) => Boolean(output.node));
  return hosted.map(({ output, index }) => ({
    externalId: `${streamName}/${index}`,
    name: hosted.length === 1 ? streamName : `${streamName} (${output.node})`,
    streamType: 'srt',
    address: output.url.includes('?') ? `${output.url}&mode=caller` : `${output.url}?mode=caller`,
    status: 'active',
  }));
}
