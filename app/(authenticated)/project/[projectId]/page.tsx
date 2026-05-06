'use client';

import Link from 'next/link';
import { useProject } from '@/contexts/ProjectContext';
import ProjectFileManager from '@/components/project/ProjectFileManager';
import MasterDataBuilder from '@/components/project/MasterDataBuilder';
import StudentSearch from '@/components/project/StudentSearch';
import OutputHistory from '@/components/project/OutputHistory';

const FEATURES = [
  {
    slug: '/score-mapping',
    icon: '📊',
    title: 'Map คะแนน',
    description: 'จับคู่คะแนนจากไฟล์ภายนอกกับ Canvas assignments',
    color: 'from-teal-500 to-cyan-500',
    requiresFiles: ['master', 'score'] as const,
  },
  {
    slug: '/status-check',
    icon: '🔍',
    title: 'ตรวจสอบสถานะ',
    description: 'เปรียบเทียบรายชื่อ Canvas กับทะเบียนนักศึกษา',
    color: 'from-blue-500 to-indigo-500',
    requiresFiles: ['master'] as const,
  },
  {
    slug: '/group-export',
    icon: '👥',
    title: 'ส่งออกกลุ่ม',
    description: 'ส่งออกรายชื่อนักศึกษาพร้อมข้อมูลกลุ่มจาก Canvas',
    color: 'from-purple-500 to-pink-500',
    requiresFiles: [] as const,
  },
  {
    slug: '/response-export',
    icon: '📝',
    title: 'ส่งออกคำตอบ',
    description: 'ส่งออกคำตอบจาก Quiz และ Assignment',
    color: 'from-orange-500 to-red-500',
    requiresFiles: [] as const,
  },
  {
    slug: '/grade-compare',
    icon: '📈',
    title: 'เปรียบเทียบคะแนน',
    description: 'เปรียบเทียบคะแนนจาก Canvas export คนละช่วงเวลา',
    color: 'from-green-500 to-emerald-500',
    requiresFiles: ['canvas'] as const,
  },
  {
    slug: '/edpuzzle-analysis',
    icon: '🎬',
    title: 'วิเคราะห์ Edpuzzle',
    description: 'วิเคราะห์สรุปคะแนน Edpuzzle playlist โดย weight ตามจำนวนคำถาม',
    color: 'from-rose-500 to-orange-500',
    requiresFiles: ['master'] as const,
  },
];

export default function ProjectPage() {
  const { project, files } = useProject();

  if (!project) return null;

  const basePath = `/project/${project.id}`;

  // Check which features have required files
  const getFileStatus = (requiresFiles: readonly string[]) => {
    if (requiresFiles.length === 0) return 'ready'; // API-based features
    const missing = requiresFiles.filter((group) => {
      const groupFiles = files[group as keyof typeof files];
      return !groupFiles || groupFiles.length === 0;
    });
    return missing.length === 0 ? 'ready' : 'missing';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          {project.courseName}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {project.courseCode}
        </p>
      </div>

      {/* File Manager + Output History side by side concept: Files first, then outputs */}
      <ProjectFileManager />

      {/* Master Data Builder — สร้างข้อมูลหลักจาก Canvas + สำนักทะเบียน */}
      <MasterDataBuilder />

      {/* Student Search — ค้นหานักศึกษาจากข้อมูลหลัก */}
      <StudentSearch />

      {/* Output History — ไฟล์ผลลัพธ์ที่บันทึกจากเครื่องมือต่างๆ */}
      <OutputHistory />

      {/* Feature Launcher */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          เลือกเครื่องมือ
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const status = getFileStatus(feature.requiresFiles);
            return (
              <Link
                key={feature.slug}
                href={`${basePath}${feature.slug}`}
                className="glass-card group relative overflow-hidden p-5 transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                {/* Gradient accent line */}
                <div className={`absolute top-0 left-0 h-1 w-full bg-gradient-to-r ${feature.color} opacity-50 transition group-hover:opacity-100`} />

                <div className="flex items-start gap-3">
                  <span className="text-2xl">{feature.icon}</span>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[var(--color-text-primary)]">
                      {feature.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                      {feature.description}
                    </p>
                  </div>
                </div>

                {/* File status indicator */}
                {feature.requiresFiles.length > 0 && (
                  <div className={`mt-3 flex items-center gap-1.5 text-xs ${
                    status === 'ready'
                      ? 'text-[var(--color-success)]'
                      : 'text-[var(--color-warning)]'
                  }`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                      status === 'ready' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-warning)]'
                    }`} />
                    {status === 'ready' ? 'พร้อมใช้งาน' : 'ต้องอัพโหลดไฟล์ก่อน'}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
