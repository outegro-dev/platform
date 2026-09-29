import { NextResponse } from "next/server";

/**
 * Redirect from a route handler to a path of this app. The standalone server
 * sees its bind address (0.0.0.0) in `request.url`, so an absolute URL built
 * from it is unreachable; a relative Location resolves against the page the
 * browser actually requested.
 */
export function redirectTo(path: string, status = 303) {
  return new NextResponse(null, { status, headers: { location: path } });
}
