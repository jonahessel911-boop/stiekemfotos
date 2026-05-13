import React from 'react';
import Image from 'next/image';

type LogoProps = {
  variant?: 'nav' | 'hero';
  className?: string;
};

export default function Logo({ variant = 'nav', className = '' }: LogoProps) {
  const isHero = variant === 'hero';
  const imgSize = isHero ? 72 : 44;

  return (
    <div className={`flex min-w-0 items-center justify-center ${className}`}>
      <div
        className={`relative shrink-0 overflow-hidden rounded-full ${
          isHero
            ? 'h-20 w-20 ring-2 ring-white shadow-lg shadow-primary/25'
            : 'h-10 w-10 ring-2 ring-primary/35 shadow-md shadow-primary/30 sm:h-11 sm:w-11 sm:ring-[3px]'
        }`}
        aria-label="stiekemefotos.nl"
      >
        <Image
          src="/logo-stiekemefotos.png"
          alt="stiekemefotos.nl"
          width={imgSize}
          height={imgSize}
          className="h-full w-full object-cover"
          priority
        />
      </div>
    </div>
  );
}
