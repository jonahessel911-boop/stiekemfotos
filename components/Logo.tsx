import React from 'react';

type LogoProps = {
  variant?: 'nav' | 'hero';
  className?: string;
};

export default function Logo({ variant = 'nav', className = '' }: LogoProps) {
  const isHero = variant === 'hero';

  return (
    <div
      className={`flex min-w-0 items-center justify-center ${className}`}
      aria-label="Stiekemevrouwen"
    >
      <span
        className={`font-extrabold tracking-tight text-primary ${
          isHero
            ? 'text-3xl md:text-4xl'
            : 'text-lg sm:text-xl whitespace-nowrap'
        }`}
      >
        Stiekemevrouwen
      </span>
    </div>
  );
}
