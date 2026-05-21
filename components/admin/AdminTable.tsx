'use client';

import React from 'react';

type Props = {
  headers: string[];
  rows: string[][];
  numericCols?: number[];
};

export default function AdminTable({ headers, rows, numericCols = [] }: Props) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} style={{ textAlign: 'center', color: '#666' }}>
                Geen data
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, idx) => (
                  <td key={idx} className={numericCols.includes(idx) ? 'num' : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
