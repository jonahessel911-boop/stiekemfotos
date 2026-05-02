import React from 'react';
import Image from 'next/image';

type LogoProps = {
  variant?: 'nav' | 'hero';
  className?: string;
};

export default function Logo({ variant = 'nav', className = '' }: LogoProps) {
  const isHero = variant === 'hero';
  const imgSize = isHero ? 56 : 44;
  const title = isHero ? 'text-3xl md:text-4xl' : 'text-lg sm:text-xl md:text-2xl';
  const tag = isHero ? 'text-xs mt-1' : 'text-[10px] sm:text-[11px] -mt-0.5 sm:mt-0';

  return (
    <div className={`flex items-center gap-2 sm:gap-3 md:gap-4 min-w-0 ${className}`}>
      <div
        className={`relative shrink-0 overflow-hidden rounded-full ${
          isHero
            ? 'w-14 h-14 ring-2 ring-white shadow-lg shadow-primary/25'
            : 'w-11 h-11 sm:w-10 sm:h-10 md:w-9 md:h-9 ring-[3px] ring-primary/35 shadow-md shadow-primary/35'
        }`}
      >
        <Image
          src="/logo-mark.png"
          alt="discreetemeisjes"
          width={imgSize}
          height={imgSize}
          className="h-full w-full object-cover"
          priority
        />
      </div>

      <div className="min-w-0">
        <div
          className={`font-bold tracking-tight text-gray-900 truncate ${title}`}
          style={{ fontFamily: 'inherit' }}
        >
          discreetemeisjes.nl
        </div>
        <div
          className={`text-gray-600 font-medium max-[360px]:hidden sm:text-gray-500 ${tag}`}
        >
          exclusieve ontmoetingen · discreet vertrouwen
        </div>
      </div>
    </div>
  );
}
