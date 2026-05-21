import { NextResponse } from "next/server";
import {
  KORTING_DISCOUNT_PERCENT,
  KORTING_PRICE_LABEL,
  KORTING_REFERENCE_LABEL,
} from "@/lib/korting-offer";
import { resolveUserForKortingPage } from "@/lib/server/abandonmentOffer";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
    if (!email) {
      return NextResponse.json({ error: "E-mail ontbreekt." }, { status: 400 });
    }

    const user = await resolveUserForKortingPage(email);

    return NextResponse.json({
      email,
      found: Boolean(user),
      naam: user?.naam ?? null,
      alreadyPaid: Boolean(user?.ontmoetjongensPaidAt),
      discountPercent: KORTING_DISCOUNT_PERCENT,
      referencePriceLabel: KORTING_REFERENCE_LABEL,
      priceLabel: KORTING_PRICE_LABEL,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
