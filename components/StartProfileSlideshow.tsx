'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';

const SLIDE_MS = 2800;

type Props = {
  slides: { src: string; alt?: string }[];
  className?: string;
};

export default function StartProfileSlideshow({ slides, className = '' }: Props) {
  const [index, setIndex] = useState(0);
  const count = slides.length;

  useEffect(() => {
    if (count <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [count]);

  if (count === 0) return null;

  return (
    <div
      className={`start-slideshow overflow-hidden rounded-sm ${className}`}
      aria-roledescription="carousel"
      aria-label="Profielen"
    >
      <div
        className="start-slideshow-track flex transition-transform duration-500 ease-in-out"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {slides.map((slide, i) => (
          <div
            key={slide.src}
            className="start-slideshow-slide relative min-w-full shrink-0"
            aria-hidden={i !== index}
          >
            <Image
              src={slide.src}
              alt={slide.alt ?? ''}
              width={800}
              height={1000}
              className="start-slideshow-img block w-full object-cover object-center"
              priority={i === 0}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
