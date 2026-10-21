import { IncomingMessage, ServerResponse, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';

/** A real Node HTTP lifecycle over an in-memory byte stream, with no TCP socket. */
export function memoryFetch(server: () => Server): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.host !== 'tori.test') throw new Error('In-memory tests only accept tori.test.');
    return new Promise<Response>((resolve, reject) => {
      const data = init.body ? Buffer.from(String(init.body)) : undefined;
      const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
      Object.defineProperty(stream, 'remoteAddress', { value: '127.0.0.1' });
      const request = new IncomingMessage(stream as Socket); request.method = init.method || 'GET'; request.url = url.pathname + url.search;
      request.headers = { host: url.host, ...Object.fromEntries(new Headers(init.headers)), ...(data ? { 'content-length': String(data.length) } : {}) };
      let sent = false;
      request._read = () => { if (!sent) { sent = true; if (data) request.push(data); request.push(null); } };
      const response = new ServerResponse(request); response.assignSocket(stream as Socket);
      const chunks: Buffer[] = []; const write = response.write.bind(response), end = response.end.bind(response);
      response.write = ((chunk: any, ...args: any[]) => { if (chunk) chunks.push(Buffer.from(chunk)); return (write as any)(chunk, ...args); }) as typeof response.write;
      response.end = ((chunk?: any, ...args: any[]) => { if (chunk && typeof chunk !== 'function') chunks.push(Buffer.from(chunk)); return (end as any)(chunk, ...args); }) as typeof response.end;
      const timeout = setTimeout(() => { stream.destroy(); reject(new Error('In-memory HTTP request timed out.')); }, 5000);
      response.on('finish', () => {
        clearTimeout(timeout);
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.getHeaders())) {
          if (value === undefined) continue;
          for (const part of Array.isArray(value) ? value : [value]) headers.append(key, String(part));
        }
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers })); stream.destroy();
      });
      server().emit('request', request, response);
    });
  }) as typeof fetch;
}
