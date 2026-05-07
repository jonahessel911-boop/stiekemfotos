import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  TIKTOK_ACCESS_TOKEN,
  TIKTOK_PIXEL_ID,
  TIKTOK_TRACK_URL,
  type TikTokTrackEvent,
} from "@/lib/tiktok";

export const runtime = "nodejs";

type TrackBody = {
  event?: TikTokTrackEvent;
  url?: string;
  referrer?: string;
  email?: string;
  externalId?: string;
};

function sha256LowerTrim(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TrackBody;
    const event = body.event;
    if (
      !event ||
      (event !== "ViewContent" &&
        event !== "CompleteRegistration" &&
        event !== "SubmitForm" &&
        event !== "SubmitApplication")
    ) {
      return NextResponse.json({ error: "Ongeldig event" }, { status: 400 });
    }

    const payload = {
      event_source: "web",
      event_source_id: TIKTOK_PIXEL_ID,
      pixel_code: TIKTOK_PIXEL_ID,
      data: [
        {
          event,
          event_time: Math.floor(Date.now() / 1000),
          user: {
            email: body.email?.trim() ? sha256LowerTrim(body.email) : null,
            phone: null,
            external_id: body.externalId?.trim() ? sha256LowerTrim(body.externalId) : null,
          },
          properties: {
            currency: null,
            content_type: "page",
          },
          page: {
            url: body.url?.trim() || null,
            referrer: body.referrer?.trim() || null,
          },
        },
      ],
    };

    const res = await fetch(TIKTOK_TRACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Access-Token": TIKTOK_ACCESS_TOKEN,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "TikTok track mislukt", status: res.status, details: text.slice(0, 600) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Track-fout" },
      { status: 500 }
    );
  }
}
