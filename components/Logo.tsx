import React from 'react';

type LogoProps = {
  variant?: 'nav' | 'hero' | 'compact';
  className?: string;
};

export default function Logo({ variant = 'nav', className = '' }: LogoProps) {
  const sizeClass =
    variant === 'hero'
      ? 'text-3xl md:text-4xl'
      : variant === 'compact'
        ? 'text-xl md:text-2xl'
        : 'text-lg sm:text-xl whitespace-nowrap';

  return (
    <div className={`flex min-w-0 items-center justify-center ${className}`} aria-label="Ontmoetjongens">
      <span className={`platform-brand ${sizeClass}`}>Ontmoetjongens</span>
    </div>
  );
}
