'use client';

import React, { useEffect } from 'react';
import ClickFlareCapture from '@/components/ClickFlareCapture';
import './lander-10.css';

const CTA_URL = 'https://911-for-me.com/cf/click';

const NAV_ITEMS = ['Nieuws', 'Relaties', 'Lifestyle', 'Dating', 'Vrouwen', 'Populair'] as const;

const COMMENTS = [
  {
    name: 'Marieke V.',
    city: 'Utrecht',
    time: '2 uur geleden',
    text: 'Werkt verrassend goed. Had niet verwacht dat je zo snel reacties krijgt.',
  },
  {
    name: 'Sander K.',
    city: 'Eindhoven',
    time: '5 uur geleden',
    text: 'Binnen paar minuten reactie. Voelt een stuk normaler dan de bekende apps.',
  },
  {
    name: 'Linda de G.',
    city: 'Groningen',
    time: 'gisteren',
    text: 'Veel normalere gesprekken. Geen eindeloos swipen meer.',
  },
] as const;

const QUOTES = [
  {
    text: 'Ik kreeg veel sneller reacties dan verwacht.',
    author: 'Sanne, 31 — Rotterdam',
  },
  {
    text: 'Het voelde natuurlijker dan Tinder.',
    author: 'Peter, 38 — Den Haag',
  },
  {
    text: 'Je hebt hier echte gesprekken.',
    author: 'Anouk, 27 — Amsterdam',
  },
] as const;

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=900&auto=format&fit=crop&q=80';
const INLINE_IMAGE =
  'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=900&auto=format&fit=crop&q=80';

export default function Lander10Page() {
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = (await r.json()) as { user?: unknown };
        if (!cancel && d.user) {
          window.location.replace('/profielen');
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  return (
    <div className="lander-10 min-h-screen bg-white">
      <ClickFlareCapture />

      {/* Top bar */}
      <div className="sans bg-[#111] text-[11px] text-white">
        <div className="mx-auto flex max-w-[720px] items-center justify-between px-4 py-1.5 sm:px-6">
          <span className="uppercase tracking-wide opacity-90">Advertorial</span>
          <span className="opacity-75">Donderdag 19 mei 2026</span>
        </div>
      </div>

      {/* Site header */}
      <header className="sans border-b border-[#e5e5e5] bg-white">
        <div className="mx-auto max-w-[720px] px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#666]">
                Lifestyle &amp; Relaties
              </p>
              <p className="mt-1 font-serif text-2xl font-bold tracking-tight text-[#111] sm:text-[1.75rem]">
                NL Relatie Nieuws
              </p>
            </div>
            <p className="text-xs text-[#777]">Onafhankelijk lifestyle-redactie</p>
          </div>
          <nav
            className="mt-4 flex gap-4 overflow-x-auto border-t border-[#eee] pt-3 text-[13px] font-medium text-[#333] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Hoofdnavigatie"
          >
            {NAV_ITEMS.map((item) => (
              <a
                key={item}
                href="#"
                className="shrink-0 hover:text-[#111] hover:underline"
                onClick={(e) => e.preventDefault()}
              >
                {item}
              </a>
            ))}
          </nav>
        </div>
      </header>

      {/* Article */}
      <main className="mx-auto max-w-[720px] px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
        <article>
          <p className="sans mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#7B2CBF]">
            Relaties · Trend
          </p>

          <h1 className="mb-4 font-serif text-[1.65rem] font-bold leading-[1.2] text-[#111] sm:text-[2rem] sm:leading-[1.15]">
            Steeds meer Nederlandse vrouwen gebruiken deze chat-app om mannen te ontmoeten
          </h1>

          <p className="sans mb-4 text-[1.05rem] leading-snug text-[#444] sm:text-lg">
            Vooral vrouwen tussen de 24 en 42 jaar kiezen steeds vaker voor online contact via
            nieuwe chatplatforms.
          </p>

          <p className="sans mb-5 text-xs text-[#777]">
            Door <span className="font-semibold text-[#333]">Redactie Lifestyle</span> | Vandaag
            bijgewerkt
          </p>

          {/* Hero image */}
          <figure className="mb-6">
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#f0f0f0]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={HERO_IMAGE}
                alt="Vrouw gebruikt haar telefoon thuis aan de keukentafel"
                className="h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
            </div>
            <figcaption className="sans mt-2 text-[11px] leading-snug text-[#888]">
              Steeds meer vrouwen starten een gesprek via chat voordat ze iemand in het echt
              ontmoeten. (Foto: ter illustratie)
            </figcaption>
          </figure>

          <p>
            Nederlanders leven steeds drukker. Werk, gezin en sociale verplichtingen vullen de
            agenda — en daardoor verdwijnt vaak de ruimte om nieuwe mensen te leren kennen op de
            traditionele manier. Uit recent onderzoek onder ruim drieduizend respondenten blijkt dat
            vooral vrouwen tussen de 24 en 42 jaar steeds vaker kiezen voor online contact als
            eerste stap.
          </p>

          <p>
            Waar datingapps jarenlang werden geassocieerd met oppervlakkig swipen, zien we nu een
            verschuiving naar rustiger platformen waar je eerst kunt chatten. Geen profielfoto die
            binnen een halve seconde wordt beoordeeld, maar een gesprek dat vanzelf op gang komt.
            Volgens relatiedeskundigen past dat bij een bredere trend: mensen willen weer{' '}
            <em>echt</em> contact, maar wel op een manier die past bij hun dagelijks leven.
          </p>

          <p>
            &ldquo;Vrouwen voelen zich online vaak comfortabeler om een eerste bericht te sturen,&rdquo;
            zegt socioloog dr. Emma Visser, die meerdere onderzoeken naar digitaal daten in
            Nederland heeft geleid. &ldquo;In een café of op kantoor is de drempel soms hoger. Via chat
            kun je rustig kijken of er een klik is, zonder meteen de druk van een fysieke
            ontmoeting.&rdquo;
          </p>

          <h2>Waarom steeds meer vrouwen kiezen voor online chatplatforms</h2>

          <p>
            De populariteit van chatgerichte platforms groeit niet omdat mensen geen echte relaties
            meer willen — integendeel. Het laagdrempelige karakter speelt een grote rol: je opent
            een gesprek wanneer het jou uitkomt, vaak &rsquo;s avonds na het werk of als de kinderen op
            bed liggen.
          </p>

          <p>
            Gebruikers geven in enquêtes aan dat ze drie dingen waarderen: snelle reacties,
            discretie en het gevoel dat gesprekken natuurlijk verlopen. In tegenstelling tot
            bekende datingapps waar matches soms wekenlang stil blijven, melden veel vrouwen dat
            ze op nieuwere chatplatforms binnen minuten een reactie krijgen — soms al terwijl ze
            hun avondthee drinken.
          </p>

          <p>
            Ook het aspect van privacy wordt genoemd. Je deelt in eerste instantie alleen wat je
            zelf wilt; pas als het klikt, wisselen mensen vaak social media of telefoonnummers uit.
            Voor vrouwen die eerder negatieve ervaringen hadden met datingapps, voelt dat als een
            veiliger tussenstap.
          </p>

          <h2>Opvallende cijfers</h2>

          <p>
            Hoewel de sector weinig openheid geeft over gebruikersaantallen, publiceren steeds meer
            platforms samengevatte statistieken. De cijfers die de afgelopen maanden circuleren zijn
            opvallend:
          </p>

          <ul className="sans mb-6 list-disc space-y-2 pl-5 text-[1.02rem] leading-relaxed text-[#222]">
            <li>
              <strong>12.000+ actieve gebruikers</strong> dagelijks online in Nederland
            </li>
            <li>
              <strong>87%</strong> van de gesprekken zou volgens interne metingen leiden tot een
              ontmoeting
            </li>
            <li>
              Gemiddelde <strong>reactietijd van circa 5 minuten</strong> in de avonduren
            </li>
            <li>
              Het grootste aantal actieve vrouwen tussen <strong>20:00 en 23:00 uur</strong>
            </li>
          </ul>

          <p>
            Of deze percentages voor iedereen gelden, valt niet eenduidig te zeggen — locatie en
            profiel spelen natuurlijk mee. Toch bevestigen meerdere onafhankelijke testers dat het
            aantal reacties merkbaar hoger ligt dan bij traditionele apps.
          </p>

          {/* Mid-article CTA */}
          <aside className="sans my-8 border border-[#e0e0e0] bg-[#fafafa] px-5 py-6 text-center sm:px-8">
            <p className="mb-4 text-[15px] font-medium leading-snug text-[#333]">
              Bekijk welke vrouwen momenteel online zijn in jouw regio.
            </p>
            <a href={CTA_URL} className="cta-btn">
              Bekijk vrouwen
            </a>
            <p className="mt-3 text-[10px] text-[#999]">Gratis registreren · 18+</p>
          </aside>

          <h2>Veel gebruikers verrast door spontane gesprekken</h2>

          <p>
            Redactie Lifestyle sprak afgelopen week met tientallen gebruikers die het platform
            recent hebben geprobeerd. Opvallend: velen noemen niet de techniek, maar het gevoel dat
            gesprekken &ldquo;vanzelf&rdquo; ontstaan.
          </p>

          {QUOTES.map((q) => (
            <blockquote key={q.author}>
              &ldquo;{q.text}&rdquo;
              <footer className="sans mt-2 text-sm not-italic text-[#666]">— {q.author}</footer>
            </blockquote>
          ))}

          <p>
            Psychologen wijzen erop dat chatten vooraf een ontmoeting kan verlagen: je leert iemands
            toon en humor kennen voordat je afspreekt. Dat zou verklaren waarom steeds meer
            Nederlanders — man én vrouw — deze route proberen, ook als ze eerder sceptisch waren
            over online daten.
          </p>

          {/* Second image */}
          <figure className="my-8">
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#f0f0f0]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={INLINE_IMAGE}
                alt="Vrienden in gesprek in een informele setting"
                className="h-full w-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
            <figcaption className="sans mt-2 text-[11px] leading-snug text-[#888]">
              Online chatten wordt steeds normaler als eerste stap richting een ontmoeting. (Foto:
              ter illustratie)
            </figcaption>
          </figure>

          <p>
            Experts verwachten dat de trend doorzet. Jongere generaties groeien op met WhatsApp,
            Instagram en direct messaging; voor hen is een chat-app om mensen te ontmoeten geen
            vreemd idee meer. Tegelijkertijd melden ook oudere gebruikers — tussen de 35 en 50 —
            dat ze de rust en het tempo waarderen.
          </p>

          <p>
            Of dit de toekomst van daten in Nederland wordt, is nog te vroeg om te zeggen. Wel is
            duidelijk dat het landschap verandert: minder eindeloos swipen, meer echte gesprekken.
            En voor wie nieuwsgierig is wat er in zijn of haar regio gebeurt, is het in ieder geval
            de moeite waard om een kijkje te nemen.
          </p>
        </article>

        {/* Bottom CTA */}
        <section className="sans mt-10 border-t border-[#ddd] bg-[#f3f3f3] px-5 py-8 text-center sm:px-8">
          <p className="mb-4 text-[16px] font-medium leading-snug text-[#222]">
            Benieuwd welke vrouwen actief zijn in jouw omgeving?
          </p>
          <a href={CTA_URL} className="cta-btn text-[15px]">
            Bekijk vrouwen in jouw regio
          </a>
        </section>

        {/* Comments */}
        <section className="sans mt-10 border-t border-[#eee] pt-8" aria-labelledby="comments-heading">
          <h2 id="comments-heading" className="mb-1 font-serif text-lg font-bold text-[#111]">
            Reacties ({COMMENTS.length + 24})
          </h2>
          <p className="mb-6 text-xs text-[#888]">Reacties worden gemodereerd.</p>

          <ul className="space-y-6">
            {COMMENTS.map((c) => (
              <li key={c.name} className="border-b border-[#eee] pb-6 last:border-0">
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0">
                  <span className="text-sm font-bold text-[#222]">{c.name}</span>
                  <span className="text-xs text-[#999]">
                    {c.city} · {c.time}
                  </span>
                </div>
                <p className="text-[14px] leading-relaxed text-[#333]">{c.text}</p>
                <button
                  type="button"
                  className="mt-2 text-xs font-medium text-[#666] hover:underline"
                  onClick={() => undefined}
                >
                  Beantwoorden · Leuk vinden
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-center text-xs text-[#aaa]">
            Meer reacties laden…
          </p>
        </section>

        {/* Footer */}
        <footer className="sans mt-12 border-t border-[#eee] pt-6 text-center text-[10px] leading-relaxed text-[#999]">
          <p>© 2026 NL Relatie Nieuws · Advertorial</p>
          <p className="mt-1">18+ · Dit artikel is gesponsord door een externe partner.</p>
        </footer>
      </main>
    </div>
  );
}
