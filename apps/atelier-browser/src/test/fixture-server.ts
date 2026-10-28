import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");

/** Path patterns of the fake ATS sites → fixture files. */
const ROUTES: [RegExp, string][] = [
  [/^\/ashby\/[^/]+\/[^/]+\/application\/?$/, "ashby.html"],
  [/^\/lever\/[^/]+\/[^/]+\/apply\/?$/, "lever.html"],
  [/^\/lever\/[^/]+\/[^/]+\/thanks\/?$/, "lever-thanks.html"],
  [/^\/greenhouse\/[^/]+\/jobs\/\d+$/, "greenhouse.html"],
  [/^\/greenhouse\/embed\/job_app$/, "greenhouse.html"],
  [/^\/company\/careers$/, "company-careers.html"],
  [/^\/workable\/[^/]+\/j\/[^/]+\/apply\/?$/, "workable.html"],
  [/^\/captcha$/, "captcha.html"],
  [/^\/captcha-frame\.html$/, "captcha-frame.html"],
  [/^\/late-captcha$/, "late-captcha.html"],
  [/^\/login$/, "login.html"],
  [/^\/validation$/, "validation.html"],
  [/^\/silent$/, "silent.html"],
];

export type FixtureServer = {
  url: (path: string) => string;
  /** Bodies of form POSTs (the Lever fixture submits a real multipart form). */
  posts: { path: string; body: string }[];
  close: () => Promise<void>;
};

/** A static server on 127.0.0.1 with the fixture forms; nothing leaves the machine. */
export async function startFixtureServer(): Promise<FixtureServer> {
  const posts: FixtureServer["posts"] = [];
  const server: Server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      posts.push({ path, body: Buffer.concat(chunks).toString("latin1") });
      if (path.startsWith("/silent/")) {
        // An XHR endpoint that accepts and says nothing (the silent fixture).
        res.writeHead(200, { "content-type": "application/json" }).end("{}");
        return;
      }
      const thanks = path.replace(/\/apply\/?$/, "/thanks");
      res.writeHead(303, { location: thanks }).end();
      return;
    }
    const route = ROUTES.find(([pattern]) => pattern.test(path));
    if (!route) {
      res
        .writeHead(404, { "content-type": "text/html" })
        .end("<h1>Page not found</h1>");
      return;
    }
    const html = await readFile(join(FIXTURES, route[1]));
    res
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    posts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
