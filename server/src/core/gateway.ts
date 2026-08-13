import http from 'node:http';
import net from 'node:net';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { picker } from './picker.js';
import { resolveGatewayRoute, type ResolvedGatewayRoute } from './routing.js';
import { recordConnectivity, type Proxy } from './store.js';

/**
 * A local HTTP proxy that forwards through the pool.
 *
 * This is what turns the pool from a database into a tool: instead of every
 * consumer fetching a proxy, using it, and reporting the outcome, they just
 * point at this port. Rotation, retry-on-failure and score feedback all happen
 * behind it. The pattern follows mubeng and rota — speak plain HTTP to the
 * client even when the upstream is SOCKS, so callers need no SOCKS support.
 *
 * Binds to loopback only. Listening on 0.0.0.0 would expose an open proxy to
 * the whole network.
 */

const MAX_ATTEMPTS = 4;
const CONNECT_TIMEOUT = 10_000;
/** How long an upstream may stay silent after receiving the ClientHello. */
const FIRST_BYTE_TIMEOUT = 6_000;

/** Buffer the client's opening bytes so they can be replayed to any upstream. */
function firstClientChunk(client: net.Socket): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.removeListener('data', onData);
      resolve(v);
    };
    const onData = (c: Buffer) => settle(c);
    const timer = setTimeout(() => settle(null), FIRST_BYTE_TIMEOUT);
    client.once('data', onData);
    client.once('error', () => settle(null));
    client.once('close', () => settle(null));
  });
}

export interface Traffic {
  at: number;
  target: string;
  via: string | null;
  ms: number;
  ok: boolean;
}

const recent: Traffic[] = [];
const note = (t: Traffic) => {
  recent.push(t);
  if (recent.length > 100) recent.shift();
};
export const traffic = () => [...recent].reverse();

export const gatewayStats = { requests: 0, failed: 0, running: false, port: 0 };

const agentFor = (p: Proxy) =>
  p.scheme === 'http'
    ? new HttpsProxyAgent(`http://${p.addr}`)
    : new SocksProxyAgent(`${p.scheme}://${p.addr}`);

const routeFilters = (route: ResolvedGatewayRoute) => ({
  country: route.country ?? undefined,
  target: route.profile?.target.id,
});

const recordRouteSuccess = (proxy: Proxy, route: ResolvedGatewayRoute, latencyMs: number) => {
  if (!route.profile) return;
  recordConnectivity(proxy.addr, [{
    ...route.profile.target,
    available: true,
    latencyMs,
    statusCode: null,
  }]);
  picker.invalidate();
};

/**
 * Open a raw TCP tunnel to `host:port` through the upstream.
 *
 * The two upstream families need different handling, and conflating them was a
 * real bug: a SOCKS agent already dials the destination itself, so layering an
 * HTTP CONNECT on top makes the *target* parse "CONNECT" as a request and
 * answer 400. Only HTTP proxies speak CONNECT.
 */
function tunnel(p: Proxy, host: string, port: number): Promise<net.Socket> {
  if (p.scheme !== 'http') {
    // SOCKS: ask the agent for a socket already connected to the destination.
    return new Promise((resolve, reject) => {
      const agent = agentFor(p) as unknown as {
        createConnection(
          opts: { host: string; port: number; timeout?: number },
          cb: (err: Error | null, sock?: net.Socket) => void,
        ): void;
      };
      const timer = setTimeout(() => reject(new Error('timeout')), CONNECT_TIMEOUT);
      agent.createConnection({ host, port, timeout: CONNECT_TIMEOUT }, (err, sock) => {
        clearTimeout(timer);
        if (err || !sock) reject(err ?? new Error('no socket'));
        else resolve(sock);
      });
    });
  }

  // HTTP proxy: issue a real CONNECT and take over the socket on success.
  return new Promise((resolve, reject) => {
    const [uHost, uPort] = p.addr.split(':');
    const req = http.request({
      method: 'CONNECT',
      path: `${host}:${port}`,
      host: uHost,
      port: Number(uPort),
      timeout: CONNECT_TIMEOUT,
      headers: { host: `${host}:${port}` },
    });
    const fail = (e: Error) => {
      req.destroy();
      reject(e);
    };
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return fail(new Error(`upstream ${res.statusCode}`));
      }
      resolve(socket);
    });
    req.on('timeout', () => fail(new Error('timeout')));
    req.on('error', fail);
    req.end();
  });
}

/**
 * Send the client's opening bytes (the TLS ClientHello) and wait for a reply.
 *
 * This is the probe that separates a real tunnel from a proxy that answers
 * "200 Connection Established" and then goes silent. Resolves with the first
 * chunk, or null if the upstream stalls or dies.
 */
function firstBytes(sock: net.Socket, head: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v: Buffer | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.removeListener('data', onData);
      sock.removeListener('error', onDead);
      sock.removeListener('close', onDead);
      resolve(v);
    };
    const onData = (c: Buffer) => settle(c);
    const onDead = () => settle(null);
    const timer = setTimeout(() => settle(null), FIRST_BYTE_TIMEOUT);
    sock.on('data', onData);
    sock.once('error', onDead);
    sock.once('close', onDead);
    if (head?.length) sock.write(head);
  });
}

async function handleConnect(client: net.Socket, hostPort: string, head: Buffer) {
  const [host, portStr] = hostPort.split(':');
  const port = Number(portStr ?? 443);
  const tried = new Set<string>();
  const t0 = Date.now();
  const route = resolveGatewayRoute(host!);
  const filters = routeFilters(route);
  gatewayStats.requests++;

  // Answer 502 while we still can. Once the tunnel is acknowledged there is no
  // way to report an HTTP error, and the client would see a bare closed socket.
  if (!picker.hasCandidates(true, filters)) {
    gatewayStats.failed++;
    note({ at: Date.now(), target: hostPort, via: null, ms: Date.now() - t0, ok: false });
    client.end('HTTP/1.1 502 Bad Gateway\r\n\r\nno usable proxy in pool\r\n');
    return;
  }

  // The client sends its ClientHello only after we acknowledge the tunnel, so
  // acknowledge first and buffer what arrives while we shop for an upstream.
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  const opening = head?.length ? head : await firstClientChunk(client);
  if (!opening) {
    client.destroy();
    return;
  }

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    // HTTPS needs an upstream that survives CONNECT -- socks4 almost never does.
    const p = picker.pick(true, tried, filters);
    if (!p) break;
    tried.add(p.addr);

    try {
      const upstream = await tunnel(p, host!, port);

      // Opening the tunnel is not proof it carries traffic: dead HTTP proxies
      // return "200 Connection Established" and then drop the TLS handshake.
      // Replaying the client's ClientHello and waiting for a reply is what
      // lets a silent upstream be retried on another node instead of hanging.
      const reply = await firstBytes(upstream, opening);
      if (!reply) {
        upstream.destroy();
        picker.report(p.addr, false);
        continue;
      }

      picker.report(p.addr, true);
      recordRouteSuccess(p, route, Date.now() - t0);
      note({
        at: Date.now(), target: hostPort,
        via: `${p.scheme}://${p.addr}`, ms: Date.now() - t0, ok: true,
      });

      client.write(reply);
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
      client.pipe(upstream);
      upstream.pipe(client);
      return;
    } catch {
      picker.report(p.addr, false);
    }
  }

  gatewayStats.failed++;
  note({ at: Date.now(), target: hostPort, via: null, ms: Date.now() - t0, ok: false });
  client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
}

function handlePlain(req: http.IncomingMessage, res: http.ServerResponse) {
  const tried = new Set<string>();
  const t0 = Date.now();
  gatewayStats.requests++;
  let targetUrl: URL;
  try {
    targetUrl = new URL(req.url ?? '');
    if (targetUrl.protocol !== 'http:') throw new Error('unsupported protocol');
  } catch {
    gatewayStats.failed++;
    note({ at: Date.now(), target: req.url ?? '?', via: null, ms: Date.now() - t0, ok: false });
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('absolute http URL required\n');
    return;
  }
  const route = resolveGatewayRoute(targetUrl.hostname);
  const filters = routeFilters(route);

  const attempt = (n: number): void => {
    const p = picker.pick(false, tried, filters);
    if (!p || n >= MAX_ATTEMPTS) {
      gatewayStats.failed++;
      note({ at: Date.now(), target: targetUrl.toString(), via: null, ms: Date.now() - t0, ok: false });
      if (!res.headersSent) res.writeHead(502);
      res.end('proxy pool exhausted');
      return;
    }
    tried.add(p.addr);

    const up = http.request(
      targetUrl,
      {
        method: req.method,
        headers: req.headers,
        agent: agentFor(p) as unknown as http.Agent,
        timeout: CONNECT_TIMEOUT,
      },
      (upRes) => {
        // A proxy that answers with its own 5xx/407 is not working, even though
        // bytes came back. Rewarding that would poison the scores.
        const code = upRes.statusCode ?? 0;
        const proxyFault = code === 407 || code === 502 || code === 503 || code === 504;
        if (proxyFault) {
          upRes.resume();
          up.destroy();
          picker.report(p.addr, false);
          if (!res.headersSent) attempt(n + 1);
          return;
        }
        picker.report(p.addr, true);
        recordRouteSuccess(p, route, Date.now() - t0);
        note({ at: Date.now(), target: targetUrl.toString(), via: `${p.scheme}://${p.addr}`, ms: Date.now() - t0, ok: true });
        res.writeHead(code || 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    const retry = () => {
      up.destroy();
      picker.report(p.addr, false);
      if (!res.headersSent) attempt(n + 1);
    };
    up.on('timeout', retry);
    up.on('error', retry);
    req.pipe(up);
  };

  attempt(0);
}

export function startGateway(port: number, host = '127.0.0.1') {
  const server = http.createServer(handlePlain);
  server.on('connect', (req, socket, head) => {
    void handleConnect(socket as net.Socket, req.url ?? '', head);
  });
  // A dead client socket must never take the process down.
  server.on('clientError', (_e, socket) => socket.destroy());
  // Nor should a busy port -- the API and background loop are still useful.
  server.on('error', (e: NodeJS.ErrnoException) => {
    gatewayStats.running = false;
    console.error(
      e.code === 'EADDRINUSE'
        ? `gateway port ${port} is in use (Clash/mihomo defaults to 7890); ` +
            `set PM_GATEWAY_PORT to a free port`
        : `gateway error: ${e.message}`,
    );
  });
  server.listen(port, host, () => {
    gatewayStats.running = true;
    gatewayStats.port = port;
    console.log(`gateway listening on http://${host}:${port}`);
  });
  return server;
}

export function stopGateway(server: http.Server | null | undefined): Promise<void> {
  gatewayStats.running = false;
  if (!server || !server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}
