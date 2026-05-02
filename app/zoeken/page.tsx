import { redirect } from 'next/navigation';

/** Oude URL; alles staat nu onder /profielen. */
export default function ZoekenPage() {
  redirect('/profielen');
}
