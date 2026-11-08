// Static file server for the built app in dist/.
import { join, normalize } from "node:path";

const root = normalize(new URL("../dist/", import.meta.url).pathname);
const port = Number(process.env.PORT ?? 3123);

Bun.serve({
  port,
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const relative = pathname.replace(/^\/+/, "");
    const target = normalize(join(root, pathname.endsWith("/") ? `${relative}index.html` : relative));
    if (!target.startsWith(root)) return new Response("Forbidden", { status: 403 });
    const file = Bun.file(target);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log(`Serving dist/ on http://localhost:${port}/`);
