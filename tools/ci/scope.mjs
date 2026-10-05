// Decides what one CI run checks and which app images it rebuilds.
// A change inside apps/ or packages/ narrows the run to the changed packages
// and everything that depends on them (turbo --affected). A change anywhere
// else (lockfile, root config, Dockerfile, this workflow) runs everything.
// Writes `filter` and `apps` to GITHUB_OUTPUT and the turbo base to GITHUB_ENV.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const APPS = [
  "landing-web",
  "id-web",
  "pay-web",
  "admin-web",
  "battleship-web",
  "edu-web",
  "auth-backend",
  "notifications-backend",
  "payments-backend",
  "battleship-backend",
  "edu-backend",
];

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const write = (file, key, value) =>
  appendFileSync(process.env[file], `${key}=${value}\n`);

const isSha = (value) => /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value);
const isAncestor = (sha) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"]);
    return true;
  } catch {
    return false; // force-push or unknown commit: nothing trustworthy to diff
  }
};

/**
 * The head of the last push to master whose run went green, i.e. was
 * released. A failed run releases nothing, so the next one must cover its
 * changes too: diffing against the previous push alone once left two apps
 * on an old image (01.10.2026). Null without the API (local runs).
 */
function lastReleased() {
  if (!process.env.GH_TOKEN || !process.env.REPO) return null;
  try {
    const sha = execFileSync(
      "gh",
      [
        "api",
        `repos/${process.env.REPO}/actions/workflows/ci.yml/runs?branch=master&event=push&status=success&per_page=1`,
        "--jq",
        ".workflow_runs[0].head_sha // empty",
      ],
      { encoding: "utf8" },
    ).trim();
    return isSha(sha) ? sha : null;
  } catch {
    return null;
  }
}

function baseCommit() {
  if (process.env.EVENT === "pull_request")
    return git("merge-base", "HEAD", `origin/${process.env.BASE_REF}`);
  const released = lastReleased();
  if (released && isAncestor(released)) return released;
  const before = process.env.BEFORE ?? "";
  return isSha(before) && isAncestor(before) ? before : null;
}

function everything(why) {
  console.log(`CI scope: everything (${why})`);
  write("GITHUB_OUTPUT", "filter", "");
  write("GITHUB_OUTPUT", "apps", JSON.stringify(APPS));
}

const base = baseCommit();
if (!base) {
  everything("no base commit to compare with");
} else {
  const changed = git("diff", "--name-only", base, "HEAD")
    .split("\n")
    .filter(Boolean);
  const outside = changed.filter(
    (file) =>
      !/^(apps|packages)\//.test(file) &&
      !/^docs\//.test(file) &&
      !file.endsWith(".md"),
  );
  if (outside.length > 0) {
    everything(`changed outside apps/ and packages/: ${outside.slice(0, 5).join(", ")}`);
  } else {
    const head = git("rev-parse", "HEAD");
    write("GITHUB_ENV", "TURBO_SCM_BASE", base);
    write("GITHUB_ENV", "TURBO_SCM_HEAD", head);
    const dry = JSON.parse(
      execFileSync(
        "pnpm",
        ["exec", "turbo", "run", "build", "--affected", "--dry=json"],
        {
          encoding: "utf8",
          env: { ...process.env, TURBO_SCM_BASE: base, TURBO_SCM_HEAD: head },
          maxBuffer: 64 * 1024 * 1024,
          // pnpm is a .cmd shim on Windows (local runs); CI is Linux.
          shell: process.platform === "win32",
        },
      ),
    );
    const affected = dry.packages.filter((name) => name !== "//");
    const apps = APPS.filter((app) => affected.includes(`@outegro/${app}`));
    console.log(
      `CI scope: since ${base.slice(0, 12)} — packages: ${affected.join(", ") || "none"}; images: ${apps.join(", ") || "none"}`,
    );
    write("GITHUB_OUTPUT", "filter", "--affected");
    write("GITHUB_OUTPUT", "apps", JSON.stringify(apps));
  }
}
