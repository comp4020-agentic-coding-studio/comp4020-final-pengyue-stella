import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const serverEntry = fileURLToPath(new URL("../server/src/server.js", import.meta.url));
const scratchDir = mkdtempSync(join(tmpdir(), "cursed-museum-restart-"));
const databaseFile = join(scratchDir, "museum.db");
let child: ChildProcessWithoutNullStreams | null = null;

async function freePort(): Promise<number> {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("could not reserve a local test port");
  await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

async function startServer(port: number): Promise<{ process: ChildProcessWithoutNullStreams; baseUrl: string }> {
  const childProcess = spawn(globalThis.process.execPath, [serverEntry], {
    cwd: projectRoot,
    env: { ...globalThis.process.env, PORT: String(port), MUSEUM_DB_FILE: databaseFile },
    stdio: ["pipe", "pipe", "pipe"],
  });
  childProcess.stdin.end();
  let diagnostics = "";
  childProcess.stdout.on("data", (chunk) => (diagnostics += chunk.toString()));
  childProcess.stderr.on("data", (chunk) => (diagnostics += chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (childProcess.exitCode !== null) throw new Error(`restart-test server exited early:\n${diagnostics}`);
    try {
      const response = await fetch(`${baseUrl}/api/world`);
      if (response.ok) return { process: childProcess, baseUrl };
    } catch {
      // The child has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  childProcess.kill("SIGKILL");
  throw new Error(`restart-test server did not become ready:\n${diagnostics}`);
}

async function stopServer(process: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!process || process.exitCode !== null) return;
  const exitPromise = once(process, "exit");
  process.kill("SIGTERM");
  const exited = await Promise.race([
    exitPromise.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
  ]);
  if (!exited && process.exitCode === null) {
    process.kill("SIGKILL");
    await exitPromise;
  }
}

afterAll(async () => {
  await stopServer(child);
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("persistence across a real process restart", () => {
  it("keeps a visitor account after stopping and starting the server on the same SQLite file", { timeout: 15000 }, async () => {
    const port = await freePort();
    let running = await startServer(port);
    child = running.process;
    const body = `Restart witness ${Date.now()}`;

    const create = await fetch(`${running.baseUrl}/api/exhibits/exhibit_builtin_hall-chandelier/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "testimony", body, authorName: "The Returning Witness" }),
    });
    expect(create.status).toBe(201);
    const { account } = await create.json();

    await stopServer(child);
    child = null;
    running = await startServer(port);
    child = running.process;

    const response = await fetch(`${running.baseUrl}/api/exhibits/exhibit_builtin_hall-chandelier`);
    expect(response.status).toBe(200);
    const { exhibit } = await response.json();
    expect(exhibit.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: account.id, body, authorName: "The Returning Witness" }),
      ]),
    );
  });
});
