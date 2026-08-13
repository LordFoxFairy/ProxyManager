#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { GATEWAY_PORT, HOST, PORT, VALIDATE_BATCH } from './config.js';
import { app, startLoop, stopLoop } from './api.js';
import { collect } from './core/collect.js';
import { startGateway, stopGateway } from './core/gateway.js';
import * as store from './core/store.js';
import { run as validate } from './core/validate.js';

const flag = (args: string[], name: string, fallback: number) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};

async function main() {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  store.init();

  switch (cmd) {
    case 'collect':
      await collect();
      break;

    case 'validate':
      await validate(flag(args, '-n', VALIDATE_BATCH));
      break;

    case 'stats':
      console.log(JSON.stringify(store.stats(), null, 2));
      break;

    case 'get': {
      const rows = store.get({
        n: flag(args, '-n', 10),
        https: args.includes('--https'),
        scheme: args.includes('--scheme') ? args[args.indexOf('--scheme') + 1] : undefined,
      });
      if (!rows.length) {
        console.error('no proxy available');
        process.exitCode = 1;
        break;
      }
      if (args.includes('--json')) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        for (const r of rows) {
          console.log(
            `${r.scheme}://${r.addr}  score=${r.score} ${r.latency_ms}ms ` +
              `${r.anonymity ?? '?'} ${r.https ? 'https' : 'http-only'} ${r.country ?? ''}`,
          );
        }
      }
      break;
    }

    case 'serve': {
      const port = flag(args, '--port', PORT);
      const gwPort = flag(args, '--gateway-port', GATEWAY_PORT);
      startLoop();
      const apiServer = serve({ fetch: app.fetch, hostname: HOST, port });
      console.log(`ProxyManager API on http://${HOST}:${port}`);
      let gatewayServer: ReturnType<typeof startGateway> | null = null;
      if (!args.includes('--no-gateway')) {
        gatewayServer = startGateway(gwPort);
        console.log(`  use it:  export https_proxy=http://127.0.0.1:${gwPort}`);
      }
      const shutdown = async () => { stopLoop(); await stopGateway(gatewayServer); apiServer.close(); };
      process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
      process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
      break;
    }

    case 'gateway': {
      // Standalone gateway, for pointing a client at the pool without the API.
      startGateway(flag(args, '--port', GATEWAY_PORT));
      break;
    }

    default:
      console.log(`ProxyManager - free proxy pool

  collect              fetch candidates from all sources
  validate [-n 1500]   check pending proxies
  stats                pool statistics
  get [-n 10] [--https] [--scheme socks5] [--json]
  serve [--port 8787] [--gateway-port 7890] [--no-gateway]
  gateway [--port 7890]  只跑本地转发代理`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
