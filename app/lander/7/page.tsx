import { Suspense } from 'react';
import Lander7Redirect from './Lander7Redirect';
import Lander7Loading from './loading';

export const dynamic = 'force-dynamic';

export default function Lander7Page() {
  return (
    <Suspense fallback={<Lander7Loading />}>
      <Lander7Redirect />
    </Suspense>
  );
}
