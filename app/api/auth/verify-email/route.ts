import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { verifyUserEmailByToken } from "@/lib/server/users";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const user = await verifyUserEmailByToken(token);
  const base = getSiteUrl();
  const redirect = new URL("/profielen", base);
  if (user) {
    redirect.searchParams.set("verified", "1");
  } else {
    redirect.searchParams.set("verify_error", "1");
  }
  return NextResponse.redirect(redirect);
}
