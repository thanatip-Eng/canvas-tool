'use client';

import { useState, useCallback } from 'react';
import { useProject } from '@/contexts/ProjectContext';
import FileUploadZone from '@/components/ui/FileUploadZone';
import FileVersionList from './FileVersionList';
import { useToast } from '@/components/ui/Toast';
import type { FileGroup } from '@/types';

interface FileGroupConfig {
  group: FileGroup;
  title: string;
  icon: string;
  description: string;
  multiple?: boolean;
  hint?: string;
}

const FILE_GROUPS: FileGroupConfig[] = [
  {
    group: 'canvas',
    title: 'Canvas Export',
    icon: '📋',
    description: 'ไฟล์ CSV จาก Canvas Grades > Export',
    hint: 'ไฟล์ CSV ที่ export จาก Canvas Gradebook',
  },
  {
    group: 'registrar',
    title: 'รายชื่อจากสำนักทะเบียน',
    icon: '🏛️',
    description: 'ไฟล์ CSV รายชื่อนักศึกษาจากสำนักทะเบียน',
    hint: 'ชื่อไฟล์ตามรูปแบบ: {courseCode}{lecSection}{labSection}.csv',
  },
  {
    group: 'score',
    title: 'ไฟล์คะแนนอื่นๆ',
    icon: '📊',
    description: 'ไฟล์คะแนนจากแหล่งอื่น (CSV/Excel)',
    hint: 'ไฟล์ CSV หรือ Excel ที่มีคอลัมน์ ID หรือ Email',
  },
];

export default function ProjectFileManager() {
  const { files, uploadFile, deleteFile } = useProject();
  const { showToast, ToastContainer } = useToast();
  const [uploadingGroup, setUploadingGroup] = useState<FileGroup | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<FileGroup>>(new Set(['canvas', 'registrar', 'score']));

  const toggleGroup = useCallback((group: FileGroup) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const handleUpload = useCallback(async (group: FileGroup, uploadedFiles: File[]) => {
    setUploadingGroup(group);
    try {
      for (const file of uploadedFiles) {
        await uploadFile(group, file);
      }
      showToast(`อัพโหลด ${uploadedFiles.length} ไฟล์สำเร็จ`, 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'อัพโหลดไฟล์ไม่สำเร็จ';
      showToast(msg, 'error');
    } finally {
      setUploadingGroup(null);
    }
  }, [uploadFile, showToast]);

  const handleDelete = useCallback(async (fileId: string) => {
    try {
      await deleteFile(fileId);
      showToast('ลบไฟล์สำเร็จ', 'success');
    } catch {
      showToast('ลบไฟล์ไม่สำเร็จ', 'error');
    }
  }, [deleteFile, showToast]);

  return (
    <div className="space-y-4">
      <ToastContainer />
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
        จัดการไฟล์
      </h2>

      {FILE_GROUPS.map((cfg) => {
        const groupFiles = files[cfg.group];
        const isExpanded = expandedGroups.has(cfg.group);
        const isUploading = uploadingGroup === cfg.group;

        return (
          <div key={cfg.group} className="glass-card overflow-hidden">
            {/* Group header */}
            <button
              onClick={() => toggleGroup(cfg.group)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-white/5"
            >
              <span className="text-xl">{cfg.icon}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-[var(--color-text-primary)]">{cfg.title}</h3>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                    {groupFiles.length}
                  </span>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">{cfg.description}</p>
              </div>
              <svg
                className={`h-5 w-5 text-[var(--color-text-muted)] transition ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Group content */}
            {isExpanded && (
              <div className="border-t border-white/5 px-5 py-3 space-y-3">
                <FileVersionList
                  files={groupFiles}
                  onDelete={handleDelete}
                  emptyMessage={`ยังไม่มีไฟล์ ${cfg.title}`}
                />

                {/* Upload zone */}
                <div className="relative">
                  {isUploading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-black/50">
                      <div className="flex items-center gap-2 text-sm text-white">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        กำลังอัพโหลด...
                      </div>
                    </div>
                  )}
                  <FileUploadZone
                    multiple={cfg.group === 'registrar'}
                    label={`อัพโหลด ${cfg.title}`}
                    hint={cfg.hint}
                    onFiles={(f) => handleUpload(cfg.group, f)}
                    disabled={isUploading}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
