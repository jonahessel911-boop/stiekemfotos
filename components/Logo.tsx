import React from 'react';
import Image from 'next/image';

type LogoProps = {
  variant?: 'nav' | 'hero';
  className?: string;
};

export default function Logo({ variant = 'nav', className = '' }: LogoProps) {
  const isHero = variant === 'hero';
  const imgSize = isHero ? 56 : 44;
  const title = isHero ? 'text-3xl md:text-4xl' : 'text-[0.8125rem] leading-snug sm:text-lg md:text-2xl';
  const tag = isHero ? 'text-xs mt-1' : 'text-[9px] sm:text-[11px] -mt-0.5 sm:mt-0 md:text-gray-500';

  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 sm:gap-3 md:gap-4 ${
        isHero ? '' : 'max-md:items-center'
      } ${className}`}
    >
      <div
        className={`relative shrink-0 overflow-hidden rounded-full ${
          isHero
            ? 'h-14 w-14 ring-2 ring-white shadow-lg shadow-primary/25'
            : 'h-9 w-9 ring-2 ring-primary/35 shadow-md shadow-primary/30 sm:h-10 sm:w-10 sm:ring-[3px] md:h-9 md:w-9'
        }`}
      >
        <Image
          src="/logo-stiekemefotos.png"
          alt=""
          width={imgSize}
          height={imgSize}
          className="h-full w-full object-cover"
          priority
        />
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={`font-bold tracking-tight text-gray-900 ${title} ${
            isHero ? '' : 'whitespace-normal break-words [overflow-wrap:anywhere] sm:whitespace-nowrap'
          }`}
          style={{ fontFamily: 'inherit' }}
        >
          {isHero ? (
            'stiekemefotos.nl'
          ) : (
            <>
              <span className="text-gray-900">stiekemefotos</span>
              <span className="text-primary">.nl</span>
            </>
          )}
        </div>
        <div className={`font-medium text-gray-600 max-[380px]:hidden sm:text-gray-500 ${tag}`}>
          Dé site waarop vrouwen bijverdienen met stiekeme fotos
        </div>
      </div>
    </div>
  );
}
