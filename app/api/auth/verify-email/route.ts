import { NextResponse } from "next/server";
import { verifyUserEmailByToken } from "@/lib/server/users";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const user = await verifyUserEmailByToken(token);
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
  const redirect = new URL("/profielen", base);
  if (user) {
    redirect.searchParams.set("verified", "1");
  } else {
    redirect.searchParams.set("verify_error", "1");
  }
  return NextResponse.redirect(redirect);
}
