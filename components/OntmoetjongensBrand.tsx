import React from 'react';

type Props = {
  variant?: 'nav' | 'hero' | 'compact';
  className?: string;
};

export default function OntmoetjongensBrand({ variant = 'hero', className = '' }: Props) {
  const sizeClass =
    variant === 'hero'
      ? 'text-3xl md:text-4xl'
      : variant === 'compact'
        ? 'text-xl md:text-2xl'
        : 'text-lg sm:text-xl whitespace-nowrap';
  return (
    <div className={`flex min-w-0 items-center justify-center ${className}`} aria-label="Ontmoetjongens">
      <span className={`start-brand ${sizeClass}`}>
        Ontmoetjongens
      </span>
    </div>
  );
}
