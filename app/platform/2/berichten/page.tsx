'use client';

import React, { Suspense } from 'react';
import Platform2Chrome from '@/components/platform2/Platform2Chrome';
import Platform2Chat from '@/components/platform2/Platform2Chat';

function BerichtenInner() {
  return <Platform2Chat />;
}

export default function Platform2BerichtenPage() {
  return (
    <Platform2Chrome>
      <Suspense fallback={<p style={{ padding: 16 }}>Berichten laden…</p>}>
        <BerichtenInner />
      </Suspense>
    </Platform2Chrome>
  );
}
