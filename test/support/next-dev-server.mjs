// Shared helper for tests that run against a real `next dev` server.
//
// Why: the earlier per-file helpers spawned `next dev` with stdio "pipe"
// without ever reading it and stopped it with child.kill(), which only
// signals the `next` wrapper. The actual next-server child kept running,
// holding the port and the pipes, so a failed run could leave the whole
// `node --test` process hanging. Readiness was also probed via "/", which
// compiles the whole guest UI (incl. Google Fonts) and could take longer
// than the 60 s timeout on a loaded machine.
//
// Now: the server runs in its own process group and is stopped as a group
// (SIGTERM, then SIGKILL), its output is drained into a small ring buffer
// (shown when it does not come up), and readiness is probed via an API route
// — the tests themselves only call API routes.

import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_READY_TIMEOUT_MS = 180_000;

export function startNextDev({ root, port, env = {} }) {
  const nextBin = path.join(root, "node_modules", ".bin", "next");
  const child = spawn(nextBin, ["dev", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const lines = [];
  const drain = (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (!line.trim()) continue;
      lines.push(line);
      if (lines.length > 60) lines.shift();
    }
  };
  child.stdout.on("data", drain);
  child.stderr.on("data", drain);
  let exited = false;
  const exitPromise = new Promise((resolve) => child.once("exit", () => {
    exited = true;
    resolve();
  }));

  async function stop() {
    if (exited) return;
    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // already gone
      }
    };
    signalGroup("SIGTERM");
    const timeout = new Promise((resolve) => setTimeout(resolve, 5_000, "timeout"));
    if ((await Promise.race([exitPromise, timeout])) === "timeout") {
      signalGroup("SIGKILL");
      await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 2_000))]);
    }
    child.stdout.destroy();
    child.stderr.destroy();
  }

  return {
    child,
    stdout: child.stdout,
    stderr: child.stderr,
    stop,
    output: () => lines.join("\n"),
    hasExited: () => exited,
  };
}

/**
 * Resolves once `probePath` answers with any HTTP status (the route is
 * compiled and the server is listening). Throws with the server's last
 * output lines if it does not come up in time or exits early.
 */
export async function waitForReady(server, baseUrl, { probePath = "/api/admin/users", timeoutMs = DEFAULT_READY_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.hasExited()) {
      throw new Error(`next dev exited before becoming ready:\n${server.output()}`);
    }
    try {
      await fetch(`${baseUrl}${probePath}`, { signal: AbortSignal.timeout(30_000) });
      return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Server at ${baseUrl} did not become ready within ${timeoutMs}ms:\n${server.output()}`);
}
