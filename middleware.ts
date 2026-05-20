import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** www.stiekemefotos.nl heeft geen DNS — doorsturen naar apex. */
export function middleware(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0]?.toLowerCase();
  if (host === "www.stiekemefotos.nl") {
    const url = request.nextUrl.clone();
    url.hostname = "stiekemefotos.nl";
    url.protocol = "https:";
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
