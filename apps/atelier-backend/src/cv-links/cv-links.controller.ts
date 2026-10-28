import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import { permissionsOf } from "@outegro/contracts/access";
import {
  AccessTokenVerifier,
  type AuthenticatedUser,
  CurrentUser,
  Public,
  RequirePermissions,
} from "@outegro/nest-common";
import type { Request, Response } from "express";
import { CvLinksService, OWNER_COOKIE } from "./cv-links.service.js";
import { contentDisposition, isBot, isLinkHash } from "./naming.js";

/** Paths served outside the /v1 prefix (cv.outegro.dev → /cv/…). */
export const cvLinkPaths = [
  "cv/robots.txt",
  "cv/device/:mark",
  "cv/:hash",
  "cv/:hash/:fileName",
];

function cookie(request: Request, name: string) {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

const noIndex = { "x-robots-tag": "noindex, nofollow, noarchive" };

/**
 * cv.outegro.dev/{hash}/{fileName}: public, no account. A wrong file name
 * redirects to the canonical one, a revoked link is 410 Gone, every answer
 * says noindex.
 */
@Public()
@Controller("cv")
export class CvLinksController {
  constructor(
    private readonly links: CvLinksService,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get("robots.txt")
  robots(@Res() response: Response) {
    response
      .status(200)
      .set({ "content-type": "text/plain; charset=utf-8", ...noIndex })
      .send("User-agent: *\nDisallow: /\n");
  }

  /** Opened once in each of the owner's browsers: their own opens stop counting. */
  @Get("device/:mark")
  device(@Param("mark") mark: string, @Res() response: Response) {
    if (!this.links.isOwnerMark(mark)) {
      response.status(404).set(noIndex).send("Not found");
      return;
    }
    const domain = this.links.cookieDomain();
    response
      .status(200)
      .cookie(OWNER_COOKIE, mark, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 400 * 24 * 3600_000,
        ...(domain ? { domain } : {}),
      })
      .set({ "content-type": "text/plain; charset=utf-8", ...noIndex })
      .send(
        "This browser is marked as the owner's: its CV opens are not counted.\n",
      );
  }

  @Get(":hash")
  async short(@Param("hash") hash: string, @Res() response: Response) {
    const link = isLinkHash(hash)
      ? await this.links.lookup(hash)
      : { status: "missing" as const };
    if (link.status === "missing")
      return void response.status(404).set(noIndex).send("Not found");
    if (link.status === "revoked")
      return void response.status(410).set(noIndex).send("Gone");
    response
      .set(noIndex)
      .redirect(302, this.links.canonicalUrl(link.hash, link.fileName));
  }

  @Get(":hash/:fileName")
  async open(
    @Param("hash") hash: string,
    @Param("fileName") fileName: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const link = isLinkHash(hash)
      ? await this.links.lookup(hash)
      : { status: "missing" as const };
    if (link.status === "missing")
      return void response.status(404).set(noIndex).send("Not found");
    if (link.status === "revoked")
      return void response.status(410).set(noIndex).send("Gone");
    if (fileName !== link.fileName)
      return void response
        .set(noIndex)
        .redirect(301, this.links.canonicalUrl(link.hash, link.fileName));
    const file = await this.links.file(link.storageKey);
    if (!file) return void response.status(410).set(noIndex).send("Gone");
    if (
      request.method === "GET" &&
      !(await this.isOwner(request)) &&
      !isBot(request.headers["user-agent"])
    )
      await this.links.countOpen(link);
    response
      .status(200)
      .set({
        "content-type": "application/pdf",
        "content-disposition": contentDisposition("inline", link.fileName),
        "cache-control": "private, max-age=0, must-revalidate",
        ...noIndex,
      })
      .send(file.body);
  }

  /** The owner's own views: their device cookie or an atelier access token. */
  private async isOwner(request: Request) {
    if (this.links.isOwnerMark(cookie(request, OWNER_COOKIE))) return true;
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) return false;
    try {
      const user = await this.verifier.verify(header.slice(7).trim());
      return permissionsOf(user.roles).has("atelier.use");
    } catch {
      return false;
    }
  }
}

/** The owner's personal device link (behind the user API). */
@RequirePermissions("atelier.use")
@Controller("cv-links")
export class CvDeviceController {
  constructor(private readonly links: CvLinksService) {}

  @Get("device")
  device(@CurrentUser() _user: AuthenticatedUser) {
    const mark = this.links.ownerMark();
    // Same shape as a link: {base}/device/{mark}; null without a cookie secret.
    return { url: mark ? this.links.canonicalUrl("device", mark) : null };
  }
}
