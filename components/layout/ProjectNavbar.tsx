'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useProject } from '@/contexts/ProjectContext';

const FEATURE_ITEMS = [
  { slug: '', label: 'ไฟล์โปรเจค', icon: '📁' },
  { slug: '/score-mapping', label: 'Map คะแนน', icon: '📊' },
  { slug: '/status-check', label: 'ตรวจสอบสถานะ', icon: '🔍' },
  { slug: '/group-export', label: 'ส่งออกกลุ่ม', icon: '👥' },
  { slug: '/response-export', label: 'ส่งออกคำตอบ', icon: '📝' },
  { slug: '/grade-compare', label: 'เปรียบเทียบคะแนน', icon: '📈' },
  { slug: '/grade-export', label: 'ส่งออกเกรด', icon: '📤' },
  { slug: '/obe-mapping', label: 'CMU OBE', icon: '🎓' },
  { slug: '/auto-grade', label: 'ให้คะแนนอัตโนมัติ', icon: '⚡' },
  { slug: '/grade-upload', label: 'อัปโหลดคะแนน', icon: '⬆️' },
];

export default function ProjectNavbar() {
  const pathname = usePathname();
  const { project } = useProject();

  if (!project) return null;

  const basePath = `/project/${project.id}`;

  return (
    <nav className="border-b border-white/10 px-6 py-2">
      <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto">
        {/* Back to courses */}
        <Link
          href="/courses"
          className="mr-2 flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text-primary)] transition"
        >
          <span>←</span>
          <span>รายวิชา</span>
        </Link>

        <div className="mx-2 h-5 w-px bg-white/10" />

        {/* Feature tabs */}
        {FEATURE_ITEMS.map((item) => {
          const href = `${basePath}${item.slug}`;
          const isActive = item.slug === ''
            ? pathname === basePath
            : pathname === href;
          return (
            <Link
              key={item.slug}
              href={href}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-semibold'
                  : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text-primary)]'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
