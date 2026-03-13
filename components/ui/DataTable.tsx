'use client';

import React, { useState, useMemo, useCallback } from 'react';

interface DataTableProps {
  headers: string[];
  rows: (string | React.ReactNode)[][];
  maxRows?: number;
  className?: string;
  stickyHeader?: boolean;
  rowClassName?: (rowIdx: number) => string;
  /** Enable pagination instead of truncation. Default page sizes: [25, 50, 100] */
  paginate?: boolean;
  /** Default rows per page when paginate=true. Defaults to 25. */
  defaultPageSize?: number;
  /** Enable per-column filters below headers */
  filterable?: boolean;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

/** Extract plain text from a React node (string, number, or nested elements) */
function extractText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (React.isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    return extractText(props.children as React.ReactNode);
  }
  return '';
}

export default function DataTable({
  headers,
  rows,
  maxRows,
  className = '',
  stickyHeader = true,
  rowClassName,
  paginate = false,
  defaultPageSize = 25,
  filterable = false,
}: DataTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [columnFilters, setColumnFilters] = useState<Record<number, string>>({});

  const handleFilterChange = useCallback((colIdx: number, value: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (value) {
        next[colIdx] = value;
      } else {
        delete next[colIdx];
      }
      return next;
    });
    setCurrentPage(1); // Reset to first page when filter changes
  }, []);

  const activeFilterCount = Object.keys(columnFilters).length;

  const clearAllFilters = useCallback(() => {
    setColumnFilters({});
    setCurrentPage(1);
  }, []);

  // Apply column filters
  const filteredRows = useMemo(() => {
    if (!filterable || activeFilterCount === 0) return rows;
    return rows.filter(row => {
      return Object.entries(columnFilters).every(([colIdxStr, filterVal]) => {
        const colIdx = Number(colIdxStr);
        const cell = row[colIdx];
        const cellText = extractText(cell).toLowerCase();
        return cellText.includes(filterVal.toLowerCase());
      });
    });
  }, [rows, columnFilters, filterable, activeFilterCount]);

  // Reset page when rows change significantly
  const totalRows = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

  // Ensure current page is valid
  const safePage = Math.min(currentPage, totalPages);
  if (safePage !== currentPage) {
    setCurrentPage(safePage);
  }

  const displayRows = useMemo(() => {
    if (paginate) {
      const start = (safePage - 1) * pageSize;
      return filteredRows.slice(start, start + pageSize);
    }
    return maxRows ? filteredRows.slice(0, maxRows) : filteredRows;
  }, [filteredRows, paginate, safePage, pageSize, maxRows]);

  // Generate page numbers to show
  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | string)[] = [];
    if (safePage <= 4) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPages);
    } else if (safePage >= totalPages - 3) {
      pages.push(1);
      pages.push('...');
      for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = safePage - 1; i <= safePage + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  }, [totalPages, safePage]);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  return (
    <div className={`table-container rounded-xl border border-white/10 ${className}`}>
      {/* Filter status bar */}
      {filterable && activeFilterCount > 0 && (
        <div className="flex items-center justify-between border-b border-white/5 bg-[var(--color-accent)]/5 px-4 py-1.5">
          <span className="text-xs text-[var(--color-text-muted)]">
            กรอง: {totalRows} จาก {rows.length} แถว ({activeFilterCount} ตัวกรอง)
          </span>
          <button
            onClick={clearAllFilters}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className={stickyHeader ? 'sticky top-0 z-10' : ''}>
          <tr className="border-b border-white/10">
            {headers.map((h, i) => (
              <th key={i} className="bg-white/5 px-4 py-3 text-left font-semibold text-[var(--color-text-muted)] whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
          {filterable && (
            <tr className="border-b border-white/10">
              {headers.map((_, i) => (
                <th key={i} className="bg-white/[0.03] px-4 py-1.5">
                  <input
                    type="text"
                    value={columnFilters[i] || ''}
                    onChange={(e) => handleFilterChange(i, e.target.value)}
                    placeholder="กรอง..."
                    className="w-full min-w-[60px] rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-white/20 outline-none focus:border-[var(--color-accent)]/50 transition"
                  />
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {displayRows.map((row, rIdx) => (
            <tr
              key={rIdx}
              className={`border-b border-white/5 transition hover:bg-white/5 ${rowClassName ? rowClassName(rIdx) : ''}`}
            >
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="px-4 py-2.5 text-[var(--color-text-primary)] whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination controls */}
      {paginate && totalRows > PAGE_SIZE_OPTIONS[0] && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-4 py-2.5">
          {/* Left: row count + page size */}
          <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
            <span>
              {((safePage - 1) * pageSize) + 1}–{Math.min(safePage * pageSize, totalRows)} จาก {totalRows}
            </span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--color-text-primary)] outline-none"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size} className="bg-[var(--color-bg-primary)]">
                  {size} แถว
                </option>
              ))}
            </select>
          </div>

          {/* Right: page navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-white/10 disabled:opacity-30 transition"
            >
              ‹
            </button>
            {pageNumbers.map((pg, i) =>
              typeof pg === 'string' ? (
                <span key={`ellipsis-${i}`} className="px-1 text-xs text-[var(--color-text-muted)]">…</span>
              ) : (
                <button
                  key={pg}
                  onClick={() => setCurrentPage(pg)}
                  className={`rounded px-2.5 py-1 text-xs transition ${
                    pg === safePage
                      ? 'bg-[var(--color-accent)] text-[var(--color-bg-primary)] font-semibold'
                      : 'text-[var(--color-text-muted)] hover:bg-white/10'
                  }`}
                >
                  {pg}
                </button>
              )
            )}
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-white/10 disabled:opacity-30 transition"
            >
              ›
            </button>
          </div>
        </div>
      )}

      {/* Legacy truncation message (backward compat when paginate=false) */}
      {!paginate && maxRows && rows.length > maxRows && (
        <div className="px-4 py-2 text-center text-sm text-[var(--color-text-muted)] border-t border-white/5">
          แสดง {maxRows} จาก {rows.length} แถว
        </div>
      )}
    </div>
  );
}
