export function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('nl-NL', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function formatEur(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`;
}
