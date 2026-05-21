'use client';

import React, { Suspense } from 'react';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import Platform2CreditsShop from '@/components/platform2/Platform2CreditsShop';

export default function Platform2CreditsPage() {
  return (
    <Platform2Chrome>
      <Suspense fallback={<p style={{ padding: 16 }}>Credits laden…</p>}>
        <Platform2CreditsShop />
      </Suspense>
    </Platform2Chrome>
  );
}
