import { collection, doc, setDoc, getDocs, query, orderBy, Timestamp, where } from 'firebase/firestore';
import { getFirebaseDb } from '@/lib/firebase';
import { validateCanvasFile, getPointsRowStart, extractAssignments } from '@/lib/canvas-utils';
import { CANVAS_FIXED_COLS } from '@/lib/constants';
import type { ParsedFile, GradeSnapshot, StudentGrade, AssignmentInfo } from '@/types';

/**
 * Convert a parsed Canvas CSV file into a GradeSnapshot object.
 */
export function parseCanvasToSnapshot(data: ParsedFile, courseName: string): Omit<GradeSnapshot, 'id' | 'savedAt'> {
  const assignments = extractAssignments(data.headers);
  const startRow = getPointsRowStart(data.rows);

  // Find SIS User ID and email column indices
  const lower = data.headers.map(h => (h || '').toLowerCase());
  const sisIdx = lower.findIndex(h => h === 'sis user id');
  const emailIdx = lower.findIndex(h => h.includes('email') || h === 'sis login id');
  const sectionIdx = lower.findIndex(h => h === 'section');

  const students: StudentGrade[] = data.rows.slice(startRow).map(row => {
    const scores: Record<string, string> = {};
    assignments.forEach(a => {
      scores[a.id || a.name] = row[a.index] || '';
    });

    return {
      name: row[0] || '',
      sisId: (row[sisIdx] || '').trim(),
      email: (row[emailIdx] || '').trim(),
      section: row[sectionIdx] || '',
      scores,
    };
  }).filter(s => s.name && s.name.toLowerCase() !== 'test student');

  // Generate a course ID from the data
  const courseId = courseName.replace(/[^a-zA-Z0-9\u0E00-\u0E7F]/g, '_').toLowerCase();

  return {
    courseId,
    courseName,
    headers: data.headers,
    assignments,
    students,
  };
}

/**
 * Save a grade snapshot to Firestore.
 */
export async function saveGradeSnapshot(
  userId: string,
  snapshot: Omit<GradeSnapshot, 'id' | 'savedAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const snapshotsRef = collection(db, 'users', userId, 'grade-snapshots');
  const newDocRef = doc(snapshotsRef);

  await setDoc(newDocRef, {
    ...snapshot,
    savedAt: Timestamp.now(),
  });

  return newDocRef.id;
}

/**
 * Get all distinct courses that have saved snapshots.
 */
export async function getSnapshotCourses(userId: string): Promise<Array<{ courseId: string; courseName: string; lastSaved: Date; count: number }>> {
  const db = getFirebaseDb();
  const snapshotsRef = collection(db, 'users', userId, 'grade-snapshots');
  const q = query(snapshotsRef, orderBy('savedAt', 'desc'));
  const snapshot = await getDocs(q);

  const courseMap = new Map<string, { courseName: string; lastSaved: Date; count: number }>();

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const courseId = data.courseId;
    if (!courseMap.has(courseId)) {
      courseMap.set(courseId, {
        courseName: data.courseName,
        lastSaved: data.savedAt.toDate(),
        count: 1,
      });
    } else {
      courseMap.get(courseId)!.count++;
    }
  });

  return Array.from(courseMap.entries()).map(([courseId, info]) => ({
    courseId,
    ...info,
  }));
}

/**
 * Get the latest snapshot for a specific course.
 */
export async function getLatestSnapshot(userId: string, courseId: string): Promise<GradeSnapshot | null> {
  const db = getFirebaseDb();
  const snapshotsRef = collection(db, 'users', userId, 'grade-snapshots');
  const q = query(snapshotsRef, where('courseId', '==', courseId));
  const snapshot = await getDocs(q);

  if (snapshot.empty) return null;

  // Sort client-side to avoid needing a composite Firestore index
  const sorted = snapshot.docs.sort((a, b) => {
    const aTime = a.data().savedAt?.toMillis?.() || 0;
    const bTime = b.data().savedAt?.toMillis?.() || 0;
    return bTime - aTime;
  });

  const latest = sorted[0];
  return { id: latest.id, ...latest.data() } as GradeSnapshot;
}
