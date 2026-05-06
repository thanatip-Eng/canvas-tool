'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import { MASTER_FIXED_COLS } from '@/lib/constants';
import type { ParsedMasterData, RegOnlyStudent } from '@/types';

interface StudentResult {
  type: 'main' | 'reg-only';
  // Canvas columns A-F
  studentName: string;
  canvasId: string;
  sisUserId: string;
  sisLoginId: string;
  integrationId: string;
  section: string;
  // Registrar info
  regStatus: string;
  matchStatus: string;
  // Assignment scores (name → score)
  scores: Array<{ name: string; score: string; pointsPossible: string }>;
}

export default function StudentSearch() {
  const { loadMasterData, files } = useProject();

  const [masterData, setMasterData] = useState<ParsedMasterData | null>(null);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const hasMasterFile = files.master.length > 0;

  // Load master data when component mounts (if available)
  useEffect(() => {
    if (!hasMasterFile) return;
    setLoadingMaster(true);
    loadMasterData()
      .then((md) => setMasterData(md))
      .finally(() => setLoadingMaster(false));
  }, [hasMasterFile, loadMasterData]);

  // Build search results
  const results = useMemo((): StudentResult[] => {
    if (!masterData || !searchQuery.trim()) return [];

    const q = searchQuery.trim().toLowerCase();

    const matched: StudentResult[] = [];

    // Search main sheet students
    for (const row of masterData.rows) {
      const studentName = row[0] || '';
      const canvasId = row[1] || '';
      const sisUserId = row[2] || '';
      const sisLoginId = row[3] || '';
      const integrationId = row[4] || '';
      const section = row[5] || '';
      const regStatus = row[6] || '';
      const matchStatus = row[7] || '';

      // Search across all identifying fields
      if (
        studentName.toLowerCase().includes(q) ||
        canvasId.toLowerCase().includes(q) ||
        sisUserId.toLowerCase().includes(q) ||
        sisLoginId.toLowerCase().includes(q) ||
        integrationId.toLowerCase().includes(q) ||
        section.toLowerCase().includes(q)
      ) {
        // Build scores
        const scores: StudentResult['scores'] = [];
        for (const asn of masterData.assignments) {
          scores.push({
            name: asn.name,
            score: row[asn.columnIndex] || '',
            pointsPossible: masterData.pointsPossibleRow[asn.columnIndex] || '',
          });
        }

        matched.push({
          type: 'main',
          studentName,
          canvasId,
          sisUserId,
          sisLoginId,
          integrationId,
          section,
          regStatus,
          matchStatus,
          scores,
        });
      }
    }

    // Search reg-only students
    for (const stu of masterData.regOnlyStudents) {
      const fullName = `${stu.name} ${stu.surname}`;
      if (
        fullName.toLowerCase().includes(q) ||
        stu.id.toLowerCase().includes(q) ||
        stu.section.toLowerCase().includes(q)
      ) {
        matched.push({
          type: 'reg-only',
          studentName: fullName,
          canvasId: '',
          sisUserId: stu.id,
          sisLoginId: '',
          integrationId: '',
          section: stu.section,
          regStatus: stu.regStatus,
          matchStatus: 'เฉพาะทะเบียน',
          scores: [],
        });
      }
    }

    return matched;
  }, [masterData, searchQuery]);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedIdx((prev) => (prev === idx ? null : idx));
  }, []);

  // Don't render at all if no master file
  if (!hasMasterFile) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        🔎 ค้นหานักศึกษา
      </h2>

      <div className="glass-card p-5 space-y-4">
        {loadingMaster ? (
          <p className="text-sm text-[var(--color-text-muted)]">กำลังโหลดข้อมูลหลัก...</p>
        ) : !masterData ? (
          <p className="text-sm text-[var(--color-warning)]">ไม่สามารถโหลดข้อมูลหลักได้</p>
        ) : (
          <>
            {/* Search input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setExpandedIdx(null);
                }}
                placeholder="พิมพ์ชื่อ, รหัสนักศึกษา, SIS User ID, Section..."
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setExpandedIdx(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Summary line */}
            {searchQuery.trim() && (
              <p className="text-xs text-[var(--color-text-muted)]">
                พบ {results.length} ผลลัพธ์
                {results.length > 50 && ' (แสดง 50 รายการแรก — กรุณาระบุคำค้นให้ชัดเจนขึ้น)'}
              </p>
            )}

            {/* Results */}
            {searchQuery.trim() && results.length > 0 && (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {results.slice(0, 50).map((r, idx) => (
                  <div
                    key={`${r.sisUserId}-${idx}`}
                    className="rounded-lg border border-white/10 bg-white/[0.03] transition hover:bg-white/[0.06]"
                  >
                    {/* Clickable header */}
                    <button
                      onClick={() => toggleExpand(idx)}
                      className="w-full px-4 py-3 text-left"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-[var(--color-text-primary)] truncate">
                              {r.studentName}
                            </span>
                            {r.type === 'reg-only' && (
                              <span className="shrink-0 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-medium text-red-400">
                                เฉพาะทะเบียน
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
                            {r.sisUserId && <span>SIS: {r.sisUserId}</span>}
                            {r.section && <span>Section: {r.section}</span>}
                            {r.regStatus && <span>สถานะ: {r.regStatus}</span>}
                          </div>
                        </div>
                        {/* Match status badge */}
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            r.matchStatus === 'ตรงกัน'
                              ? 'bg-green-500/20 text-green-400'
                              : r.matchStatus === 'เฉพาะ Canvas'
                                ? 'bg-yellow-500/20 text-yellow-400'
                                : r.matchStatus === 'เฉพาะทะเบียน'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-white/10 text-[var(--color-text-muted)]'
                          }`}
                        >
                          {r.matchStatus || '-'}
                        </span>
                      </div>
                    </button>

                    {/* Expanded details */}
                    {expandedIdx === idx && (
                      <div className="border-t border-white/5 px-4 py-3 space-y-3">
                        {/* Full info */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                          <InfoRow label="Student" value={r.studentName} />
                          <InfoRow label="ID" value={r.canvasId} />
                          <InfoRow label="SIS User ID" value={r.sisUserId} />
                          <InfoRow label="SIS Login ID" value={r.sisLoginId} />
                          <InfoRow label="Integration ID" value={r.integrationId} />
                          <InfoRow label="Section" value={r.section} />
                          <InfoRow label="Reg Status" value={r.regStatus} />
                          <InfoRow label="สถานะจับคู่" value={r.matchStatus} />
                        </div>

                        {/* Assignment scores */}
                        {r.scores.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-[var(--color-text-primary)]">
                              คะแนน ({r.scores.length} assignments)
                            </p>
                            <div className="max-h-48 overflow-y-auto rounded-lg border border-white/5 bg-black/20">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-white/5 text-[var(--color-text-muted)]">
                                    <th className="px-3 py-1.5 text-left font-medium">Assignment</th>
                                    <th className="px-3 py-1.5 text-right font-medium w-24">คะแนน</th>
                                    <th className="px-3 py-1.5 text-right font-medium w-20">เต็ม</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.scores.map((s, si) => (
                                    <tr key={si} className="border-b border-white/[0.03]">
                                      <td className="px-3 py-1.5 text-[var(--color-text-primary)] truncate max-w-[250px]">
                                        {s.name}
                                      </td>
                                      <td className={`px-3 py-1.5 text-right ${
                                        s.score === '' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-primary)]'
                                      }`}>
                                        {s.score || '-'}
                                      </td>
                                      <td className="px-3 py-1.5 text-right text-[var(--color-text-muted)]">
                                        {s.pointsPossible || '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* No results */}
            {searchQuery.trim() && results.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)]">
                ไม่พบนักศึกษาที่ตรงกับ &ldquo;{searchQuery.trim()}&rdquo;
              </p>
            )}

            {/* Hint when empty */}
            {!searchQuery.trim() && (
              <p className="text-xs text-[var(--color-text-muted)]">
                ค้นหาจากข้อมูลหลัก ({masterData.rows.length} คนใน Canvas
                {masterData.regOnlyStudents.length > 0 &&
                  ` + ${masterData.regOnlyStudents.length} คนเฉพาะทะเบียน`}
                ) — พิมพ์ชื่อ, รหัส, section เพื่อค้นหา
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Small info row for the expanded view */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--color-text-muted)] w-28 shrink-0">{label}:</span>
      <span className="text-[var(--color-text-primary)] truncate">{value || '-'}</span>
    </div>
  );
}
