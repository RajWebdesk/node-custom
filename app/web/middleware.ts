import { NextResponse, type NextRequest } from "next/server";

// Presence check only. The API enforces the session and CSRF on every request.
// This keeps signed-out visitors on the sign-in page without a round trip.
const PUBLIC_PATHS = new Set(["/login", "/forgot-password"]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (!req.cookies.get("sid")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
