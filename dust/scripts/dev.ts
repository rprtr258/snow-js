// Dev server: rebuilds dist/ on source changes and reloads connected browsers.
import { watch } from "node:fs";
import { join, normalize } from "node:path";

const root = normalize(new URL("../", import.meta.url).pathname);
const dist = join(root, "dist");
const port = Number(process.env.PORT ?? 3123);

const encoder = new TextEncoder();
const reloadClients = new Set<ReadableStreamDefaultController<Uint8Array>>();

const RELOAD_SCRIPT = `<script>new EventSource("/__dev/reload").onmessage = () => location.reload();</script>`;

let building = false;
let rebuildQueued = false;

async function build() {
  if (building) {
    rebuildQueued = true;
    return;
  }
  building = true;
  const proc = Bun.spawn([process.execPath, "run", join(root, "scripts/build.ts")], {
    stdout: "inherit",
    stderr: "inherit",
  });
  await proc.exited;
  building = false;
  for (const client of reloadClients) {
    try {
      client.enqueue(encoder.encode("data: reload\n\n"));
    } catch {
      reloadClients.delete(client);
    }
  }
  if (rebuildQueued) {
    rebuildQueued = false;
    await build();
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined;
function scheduleBuild() {
  clearTimeout(debounce);
  debounce = setTimeout(() => void build(), 250);
}

await build();

for (const dir of ["src", "static"]) {
  watch(join(root, dir), { recursive: true }, (_event, file) => {
    if (file?.endsWith("~") || file?.endsWith(".swp")) return;
    scheduleBuild();
  });
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__dev/reload") {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          reloadClients.add(c);
          c.enqueue(encoder.encode(": connected\n\n"));
        },
        cancel() {
          reloadClients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname.replace(/^\/+/, "");
    const target = normalize(join(dist, pathname.endsWith("/") ? `${relative}index.html` : relative));
    if (!target.startsWith(dist)) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(target);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    if (target.endsWith(".html")) {
      const html = await file.text();
      return new Response(html.replace("</body>", `${RELOAD_SCRIPT}</body>`), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(file);
  },
});

console.log(`Watching src/ and static/, serving dist/ on http://localhost:${port}/`);
