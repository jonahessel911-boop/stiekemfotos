import Link from 'next/link';

export default function VoorwaardenPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-16 max-w-2xl mx-auto">
      <Link href="/start" className="text-primary text-sm font-medium mb-8 inline-block">
        ← Terug
      </Link>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Algemene voorwaarden</h1>
      <div className="prose prose-gray text-gray-700 space-y-4 text-sm leading-relaxed">
        <p>
          Dit is een voorbeeldtekst voor demonstratiedoeleinden. Pas deze aan met je
          juridische tekst voordat je live gaat.
        </p>
        <p>
          Door stiekemefotos.nl te gebruiken, bevestig je dat je minimaal 18 jaar
          bent en akkoord gaat met respectvol en discreet gedrag ten opzichte van
          anderen.
        </p>
      </div>
    </div>
  );
}
