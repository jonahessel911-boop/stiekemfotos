import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildClickflareClickRedirectUrl,
  CF_CPID_COOKIE,
} from "@/lib/clickflare-redirect";
import { SVL_CLICK_ID_COOKIE } from "@/lib/clickflare-postback";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function toIncomingSearchParams(
  sp: Record<string, string | string[] | undefined>
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
  }
  return params;
}

export default async function Lander7Page({ searchParams }: Props) {
  const sp = await searchParams;
  const incoming = toIncomingSearchParams(sp);

  const h = await headers();
  const cookieStore = await cookies();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const qs = incoming.toString();
  const lpurl = `${proto}://${host}/lander/7${qs ? `?${qs}` : ""}`;

  const target = buildClickflareClickRedirectUrl({
    incomingSearch: incoming,
    lpurl,
    referrer: h.get("referer"),
    cpidCookie: cookieStore.get(CF_CPID_COOKIE)?.value,
    clickIdCookie: cookieStore.get(SVL_CLICK_ID_COOKIE)?.value,
  });

  redirect(target);
}
