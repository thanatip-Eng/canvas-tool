'use client';

import { useState, useCallback } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import StepWizard from '@/components/ui/StepWizard';
import FileSelector from '@/components/project/FileSelector';
import DataTable from '@/components/ui/DataTable';
import FilterTabs from '@/components/ui/FilterTabs';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { buildXlsxMultiSheet, downloadXlsx } from '@/lib/xlsx-utils';
import type { SheetData } from '@/lib/xlsx-utils';
import { validateCanvasFile, getPointsRowStart } from '@/lib/canvas-utils';
import { parseRegFilename, performStatusCheck } from '@/lib/registrar-utils';
import { STATUS, STATUS_LABELS, STATUS_COLORS } from '@/lib/constants';
import type { ParsedFile, RegistrarFile, CheckEntry, ProjectFile } from '@/types';

interface StatusCheckResult {
  sections: SectionResult[];
  allEntries: CheckEntry[];
  canvasOnlyStudents: CheckEntry[];
  canvasTotal: number;
  regTotal: number;
  totalMatched: number;
  totalIssues: number;
}

interface SectionResult {
  label: string;
  filename: string;
  courseCode: string;
  lecSection: string;
  labSection: string;
  matched: CheckEntry[];
  canvasOnly: CheckEntry[];
  regOnly: CheckEntry[];
  regTotal: number;
}

const STEPS = [
  { label: 'เลือกไฟล์ Canvas' },
  { label: 'เลือกไฟล์ทะเบียน' },
  { label: 'ผลการตรวจสอบ' },
];

const STATUS_EXPORT_TEXT: Record<string, string> = {
  [STATUS.MATCH]: 'ปกติ',
  [STATUS.CANVAS_ONLY]: 'มีใน Canvas แต่ไม่มีในทะเบียน',
  [STATUS.REG_ONLY]: 'มีในทะเบียน แต่ไม่มีใน Canvas',
};

type FilterKey = 'all' | 'match' | 'canvas-only' | 'reg-only';

export default function StatusCheckPage() {
  const { files, loadFileContent, saveOutput } = useProject();
  const { showToast, ToastContainer } = useToast();

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCanvasFile, setSelectedCanvasFile] = useState<ProjectFile | null>(null);
  const [canvasData, setCanvasData] = useState<ParsedFile | null>(null);
  const [loadingCanvas, setLoadingCanvas] = useState(false);

  // Registrar file selection (multi-select from project files)
  const [selectedRegIds, setSelectedRegIds] = useState<Set<string>>(new Set());
  const [registrarFiles, setRegistrarFiles] = useState<RegistrarFile[]>([]);
  const [loadingReg, setLoadingReg] = useState(false);

  const [results, setResults] = useState<StatusCheckResult | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [saving, setSaving] = useState(false);

  // Load Canvas file
  const handleLoadCanvas = useCallback(async (file: ProjectFile) => {
    setSelectedCanvasFile(file);
    setLoadingCanvas(true);
    try {
      const data = await loadFileContent(file);
      if (!validateCanvasFile(data)) {
        showToast('ไฟล์ไม่ใช่ Canvas gradebook export ที่ถูกต้อง', 'error');
        return;
      }
      setCanvasData(data);
      showToast(`โหลดไฟล์ Canvas สำเร็จ: ${data.rows.length} แถว`, 'success');
      setCurrentStep(2);
    } catch {
      showToast('เกิดข้อผิดพลาดในการอ่านไฟล์', 'error');
    } finally {
      setLoadingCanvas(false);
    }
  }, [loadFileContent, showToast]);

  // Toggle registrar file selection
  const toggleRegFile = useCallback((fileId: string) => {
    setSelectedRegIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  // Load selected registrar files and run comparison
  const runComparison = useCallback(async () => {
    if (!canvasData || selectedRegIds.size === 0) return;
    setLoadingReg(true);

    try {
      const regFiles: RegistrarFile[] = [];
      for (const fileId of selectedRegIds) {
        const pf = files.registrar.find(f => f.id === fileId);
        if (!pf) continue;
        const data = await loadFileContent(pf);
        const parsed = parseRegFilename(pf.originalFilename);
        regFiles.push({
          filename: pf.originalFilename,
          courseCode: parsed?.courseCode || '',
          lecSection: parsed?.lecSection || '',
          labSection: parsed?.labSection || '',
          data,
        });
      }

      setRegistrarFiles(regFiles);
      const result = performStatusCheck(canvasData, regFiles) as StatusCheckResult;
      setResults(result);
      setActiveFilter('all');
      setCurrentStep(3);
      showToast('ตรวจสอบสถานะเสร็จสิ้น', 'success');
    } catch {
      showToast('เกิดข้อผิดพลาดในการตรวจสอบ', 'error');
    } finally {
      setLoadingReg(false);
    }
  }, [canvasData, selectedRegIds, files.registrar, loadFileContent, showToast]);

  // Build W status lookup from all loaded registrar files (column D = index 3)
  const buildWStatusLookup = useCallback((): Map<string, string> => {
    const lookup = new Map<string, string>();
    for (const rf of registrarFiles) {
      const regHeaders = rf.data.headers.map(h => (h || '').toLowerCase().trim());
      const regIdIdx = regHeaders.findIndex(h => h === 'id');
      // Column D (index 3) contains W/drop status — it may have no header name
      const wStatusIdx = 3;
      rf.data.rows.forEach(row => {
        const id = (row[regIdIdx] || '').trim();
        if (id && wStatusIdx < row.length) {
          const wVal = (row[wStatusIdx] || '').trim();
          if (wVal) lookup.set(id, wVal);
        }
      });
    }
    return lookup;
  }, [registrarFiles]);

  // Build Canvas student lookup by SIS ID → full Canvas row
  const buildCanvasRowLookup = useCallback((): Map<string, string[]> => {
    if (!canvasData) return new Map();
    const headers = canvasData.headers.map(h => (h || '').toLowerCase());
    const cSisIdx = headers.findIndex(h => h === 'sis user id');
    const startRow = getPointsRowStart(canvasData.rows);
    const lookup = new Map<string, string[]>();
    canvasData.rows.slice(startRow).forEach(row => {
      const sisId = (row[cSisIdx] || '').trim();
      if (sisId) lookup.set(sisId, row);
    });
    return lookup;
  }, [canvasData]);

  // Build XLSX buffer with multi-sheet output
  const buildXlsxBuffer = useCallback((): Uint8Array | null => {
    if (!results || !canvasData) return null;

    const wStatusLookup = buildWStatusLookup();
    const canvasRowLookup = buildCanvasRowLookup();

    // Canvas columns A-F: Student, ID, SIS User ID, SIS Login ID, Integration ID, Section
    const canvasHeaders = canvasData.headers.slice(0, 6);
    const xlsxHeaders = [...canvasHeaders, 'W Status', 'สถานะ'];

    // Sheet 1: All matched students — Canvas A-F + W Status
    const matchedEntries = results.allEntries.filter(e => e.status === STATUS.MATCH);
    const matchedRows: string[][] = matchedEntries.map(entry => {
      const canvasRow = canvasRowLookup.get(entry.id);
      const baseRow = canvasRow ? canvasRow.slice(0, 6) : [entry.name, '', entry.id, '', '', entry.canvasSection || ''];
      const wStatus = wStatusLookup.get(entry.id) || '';
      return [...baseRow, wStatus, STATUS_EXPORT_TEXT[entry.status] || ''];
    });

    // Sheet 2: Canvas-only students
    const canvasOnlyEntries = results.allEntries.filter(e => e.status === STATUS.CANVAS_ONLY);
    const canvasOnlyHeaders = [...canvasHeaders, 'สถานะ'];
    const canvasOnlyRows: string[][] = canvasOnlyEntries.map(entry => {
      const canvasRow = canvasRowLookup.get(entry.id);
      const baseRow = canvasRow ? canvasRow.slice(0, 6) : [entry.name, '', entry.id, '', '', entry.canvasSection || ''];
      return [...baseRow, STATUS_EXPORT_TEXT[entry.status] || 'มีใน Canvas แต่ไม่มีในทะเบียน'];
    });

    // Sheet 3: Reg-only students
    const regOnlyEntries = results.allEntries.filter(e => e.status === STATUS.REG_ONLY);
    const regOnlyHeaders = ['รหัสนักศึกษา', 'ชื่อ (ทะเบียน)', 'W Status', 'Section (ทะเบียน)', 'สถานะ'];
    const regOnlyRows: string[][] = regOnlyEntries.map(entry => {
      const wStatus = wStatusLookup.get(entry.id) || '';
      return [entry.id, entry.surname || '-', wStatus, entry.section, STATUS_EXPORT_TEXT[entry.status] || 'มีในทะเบียน แต่ไม่มีใน Canvas'];
    });

    const sheets: SheetData[] = [
      { name: 'ตรวจสอบสถานะ', headers: xlsxHeaders, rows: matchedRows },
      { name: 'เฉพาะ Canvas', headers: canvasOnlyHeaders, rows: canvasOnlyRows },
      { name: 'เฉพาะทะเบียน', headers: regOnlyHeaders, rows: regOnlyRows },
    ];

    return buildXlsxMultiSheet(sheets);
  }, [results, canvasData, buildWStatusLookup, buildCanvasRowLookup]);

  const handleExport = useCallback(() => {
    const buf = buildXlsxBuffer();
    if (!buf) return;
    downloadXlsx(buf, 'student_status_check');
    showToast('ดาวน์โหลดไฟล์ XLSX สำเร็จ', 'success');
  }, [buildXlsxBuffer, showToast]);

  const handleSaveToProject = useCallback(async () => {
    const buf = buildXlsxBuffer();
    if (!buf || !results) return;
    setSaving(true);
    try {
      await saveOutput('status-check', 'ตรวจสอบสถานะนักศึกษา', buf, {
        matched: results.totalMatched,
        canvasOnly: results.canvasOnlyStudents.length,
        regOnly: results.totalIssues - results.canvasOnlyStudents.length,
      });
      showToast('บันทึกผลลัพธ์ไปโปรเจคสำเร็จ', 'success');
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  }, [buildXlsxBuffer, results, saveOutput, showToast]);

  const handleReset = useCallback(() => {
    setCurrentStep(1);
    setCanvasData(null);
    setSelectedCanvasFile(null);
    setSelectedRegIds(new Set());
    setRegistrarFiles([]);
    setResults(null);
    setActiveFilter('all');
  }, []);

  // Filtering
  const getFilteredEntries = useCallback((): CheckEntry[] => {
    if (!results) return [];
    if (activeFilter === 'all') return results.allEntries;
    return results.allEntries.filter((e) => e.status === activeFilter);
  }, [results, activeFilter]);

  const getFilterOptions = useCallback(() => {
    if (!results) return [];
    const all = results.allEntries;
    return [
      { key: 'all', label: 'ทั้งหมด', count: all.length },
      { key: STATUS.MATCH, label: 'ตรงกัน', count: all.filter((e) => e.status === STATUS.MATCH).length },
      { key: STATUS.CANVAS_ONLY, label: 'เฉพาะ Canvas', count: all.filter((e) => e.status === STATUS.CANVAS_ONLY).length },
      { key: STATUS.REG_ONLY, label: 'เฉพาะทะเบียน', count: all.filter((e) => e.status === STATUS.REG_ONLY).length },
    ];
  }, [results]);

  const groupBySection = useCallback((entries: CheckEntry[]): Record<string, CheckEntry[]> => {
    const grouped: Record<string, CheckEntry[]> = {};
    entries.forEach((e) => {
      const key = e.section;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(e);
    });
    return grouped;
  }, []);

  const renderStatusBadge = (status: string) => {
    const colorClass = STATUS_COLORS[status] || 'text-[var(--color-text-muted)]';
    return <span className={`font-medium ${colorClass}`}>{STATUS_LABELS[status] || status}</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">ตรวจสอบสถานะนักศึกษา</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">เปรียบเทียบรายชื่อนักศึกษาใน Canvas กับไฟล์ทะเบียน</p>
      </div>

      <div className="glass-card p-6">
        <StepWizard steps={STEPS} currentStep={currentStep}>
          {/* Step 1: Select Canvas file */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ Canvas Gradebook</h3>
            <FileSelector group="canvas" label="Canvas Export" selectedFileId={selectedCanvasFile?.id} onSelect={handleLoadCanvas} />
            {loadingCanvas && (
              <div className="flex items-center gap-2 text-sm text-[var(--color-accent)]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                กำลังโหลดไฟล์...
              </div>
            )}
            {canvasData && (
              <div className="rounded-xl border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-4 py-3 text-sm">
                <p className="font-medium text-[var(--color-success)]">โหลดไฟล์สำเร็จ</p>
                <p className="mt-1 text-[var(--color-text-muted)]">{canvasData.rows.length} แถว, {canvasData.headers.length} คอลัมน์</p>
              </div>
            )}
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={!canvasData} onClick={() => setCurrentStep(2)}>ถัดไป</button>
            </div>
          </div>

          {/* Step 2: Select Registrar files */}
          <div className="space-y-4">
            <h3 className="font-semibold text-[var(--color-text-primary)]">เลือกไฟล์ทะเบียน</h3>
            {files.registrar.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4 text-center">
                <p className="text-sm text-[var(--color-warning)]">ยังไม่มีไฟล์ทะเบียน — กรุณาอัพโหลดในหน้าโปรเจค</p>
              </div>
            ) : (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <button
                    onClick={() => setSelectedRegIds(new Set(files.registrar.map(f => f.id)))}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-accent)] bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 transition"
                  >
                    เลือกทั้งหมด
                  </button>
                  <button
                    onClick={() => setSelectedRegIds(new Set())}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] bg-white/5 hover:bg-white/10 transition"
                  >
                    ยกเลิกทั้งหมด
                  </button>
                  <span className="text-xs text-[var(--color-text-muted)]">
                    ({selectedRegIds.size}/{files.registrar.length})
                  </span>
                </div>
                <div className="space-y-2 rounded-lg border border-white/10 p-3">
                  {files.registrar.map((file) => {
                    const isSelected = selectedRegIds.has(file.id);
                    return (
                      <label key={file.id} className={`flex cursor-pointer items-center gap-3 rounded-lg p-2.5 transition ${isSelected ? 'bg-[var(--color-accent)]/10' : 'hover:bg-white/5'}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleRegFile(file.id)} className="accent-[var(--color-accent)]" />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">{file.originalFilename}</span>
                          <div className="flex gap-3 text-xs text-[var(--color-text-muted)]">
                            {file.metadata?.lecSection && <span>Lec {file.metadata.lecSection} / Lab {file.metadata.labSection}</span>}
                            <span>{file.rowCount} คน</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="flex justify-between">
              <button className="btn btn-secondary" onClick={() => setCurrentStep(1)}>ย้อนกลับ</button>
              <button className="btn btn-primary" disabled={selectedRegIds.size === 0 || loadingReg} onClick={runComparison}>
                {loadingReg ? 'กำลังตรวจสอบ...' : 'ตรวจสอบสถานะ'}
              </button>
            </div>
          </div>

          {/* Step 3: Results */}
          {results && (() => {
            const filteredEntries = getFilteredEntries();
            const grouped = groupBySection(filteredEntries);
            return (
              <div className="space-y-6">
                <div className="flex flex-wrap gap-3">
                  <button onClick={handleExport} className="btn btn-primary">📥 ดาวน์โหลด XLSX</button>
                  <button onClick={handleSaveToProject} disabled={saving} className="rounded-xl bg-[var(--color-accent)] px-6 py-2.5 font-semibold text-[var(--color-bg-primary)] transition hover:bg-[var(--color-accent-dark)] disabled:opacity-50">
                    {saving ? '💾 กำลังบันทึก...' : '💾 บันทึกไปโปรเจค'}
                  </button>
                  <button className="btn btn-secondary" onClick={handleReset}>เริ่มใหม่</button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard icon="👥" label="นศ. ใน Canvas" value={results.canvasTotal} color="text-[var(--color-info)]" />
                  <StatCard icon="✅" label="ตรงกัน" value={results.totalMatched} color="text-[var(--color-success)]" />
                  <StatCard icon="⚠️" label="เฉพาะ Canvas" value={results.canvasOnlyStudents.length} color="text-[var(--color-warning)]" />
                  <StatCard icon="❌" label="เฉพาะทะเบียน" value={results.totalIssues - results.canvasOnlyStudents.length} color="text-[var(--color-danger)]" />
                </div>
                <FilterTabs filters={getFilterOptions()} activeFilter={activeFilter} onChange={(key) => setActiveFilter(key as FilterKey)} />
                {filteredEntries.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-12 text-center text-[var(--color-text-muted)]">ไม่พบข้อมูลตามเงื่อนไขที่เลือก</div>
                ) : (
                  Object.entries(grouped).map(([section, items]) => (
                    <div key={section} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-white/5 px-4 py-3">
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{section}</span>
                      </div>
                      <DataTable
                        headers={['รหัสนักศึกษา', 'ชื่อ (Canvas)', 'ชื่อ (ทะเบียน)', 'Section (Canvas)', 'สถานะ']}
                        rows={items.map((item) => [item.id, item.name, item.surname || '-', item.canvasSection || '-', renderStatusBadge(item.status)])}
                        stickyHeader={false}
                        paginate
                        filterable
                      />
                    </div>
                  ))
                )}
              </div>
            );
          })()}
        </StepWizard>
      </div>
      <ToastContainer />
    </div>
  );
}
