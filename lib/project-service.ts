import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  orderBy,
  getDocs,
  where,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from './firebase';
import {
  buildFilePath,
  buildOutputPath,
  uploadFileToStorage,
  uploadXlsxToStorage,
  deleteFileFromStorage,
  downloadFileFromStorage,
} from './firebase-storage';
import { parseFile, parseFileFromBlob } from './csv-utils';
import { validateCanvasFile, extractAssignments } from './canvas-utils';
import { parseRegFilename } from './registrar-utils';
import type { Course, Project, ProjectFile, OutputFile, FileGroup, ParsedFile, EdpuzzleConfig } from '@/types';

// ========== Project CRUD ==========

/**
 * Generate a deterministic project ID from a Canvas course ID.
 */
export function getProjectId(canvasCourseId: number): string {
  return `course_${canvasCourseId}`;
}

/**
 * Create or update a project for a course.
 * If the project already exists, only updatedAt is refreshed.
 */
export async function createProject(userId: string, course: Course): Promise<Project> {
  const db = getFirebaseDb();
  const projectId = getProjectId(course.id);
  const projectRef = doc(db, 'users', userId, 'projects', projectId);
  const existing = await getDoc(projectRef);

  if (existing.exists()) {
    // Update timestamp
    await setDoc(projectRef, { updatedAt: serverTimestamp() }, { merge: true });
    return { id: projectId, ...existing.data(), updatedAt: Timestamp.now() } as Project;
  }

  const project: Omit<Project, 'id'> = {
    canvasCourseId: course.id,
    courseName: course.name,
    courseCode: course.course_code,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };

  await setDoc(projectRef, project);
  return { id: projectId, ...project };
}

/**
 * Get a project by ID.
 */
export async function getProject(userId: string, projectId: string): Promise<Project | null> {
  const db = getFirebaseDb();
  const projectRef = doc(db, 'users', userId, 'projects', projectId);
  const snapshot = await getDoc(projectRef);
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() } as Project;
}

/**
 * Get all projects for a user, sorted by updatedAt desc.
 */
export async function getUserProjects(userId: string): Promise<Project[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'users', userId, 'projects'),
    orderBy('updatedAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as Project);
}

// ========== File CRUD ==========

/**
 * Upload a file to a project.
 * Parses the file for metadata, uploads to Storage, saves metadata to Firestore.
 */
export async function uploadProjectFile(
  userId: string,
  projectId: string,
  group: FileGroup,
  file: File
): Promise<ProjectFile> {
  const db = getFirebaseDb();

  // Generate a unique file ID
  const fileId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Parse file to extract metadata
  const parsed = await parseFile(file);
  const metadata: Record<string, string> = {};

  if (group === 'canvas') {
    // Validate and extract assignment count
    const isValid = validateCanvasFile(parsed);
    if (!isValid) {
      throw new Error('ไฟล์ Canvas ไม่ถูกต้อง — ต้องมีคอลัมน์ Student, ID, SIS User ID');
    }
    const assignments = extractAssignments(parsed.headers);
    metadata.assignmentCount = String(assignments.length);
  } else if (group === 'registrar') {
    // Parse registrar filename for section info
    const regInfo = parseRegFilename(file.name);
    if (regInfo) {
      metadata.courseCode = regInfo.courseCode;
      metadata.lecSection = regInfo.lecSection;
      metadata.labSection = regInfo.labSection;
    }
  }

  // Upload to Firebase Storage
  const storagePath = buildFilePath(userId, projectId, group, fileId, file.name);
  const { fileSize } = await uploadFileToStorage(storagePath, file);

  // Save metadata to Firestore
  const projectFile: Omit<ProjectFile, 'id'> = {
    group,
    originalFilename: file.name,
    storagePath,
    uploadedAt: Timestamp.now(),
    fileSize,
    rowCount: parsed.rows.length,
    columnCount: parsed.headers.length,
    metadata,
  };

  const fileRef = doc(db, 'users', userId, 'projects', projectId, 'files', fileId);
  await setDoc(fileRef, projectFile);

  // Update project timestamp
  const projectRef = doc(db, 'users', userId, 'projects', projectId);
  await setDoc(projectRef, { updatedAt: serverTimestamp() }, { merge: true });

  return { id: fileId, ...projectFile };
}

/**
 * Get all files for a project, optionally filtered by group.
 * Returns files sorted by uploadedAt desc (most recent first).
 */
export async function getProjectFiles(
  userId: string,
  projectId: string,
  group?: FileGroup
): Promise<ProjectFile[]> {
  const db = getFirebaseDb();
  const filesRef = collection(db, 'users', userId, 'projects', projectId, 'files');
  const q = group
    ? query(filesRef, where('group', '==', group), orderBy('uploadedAt', 'desc'))
    : query(filesRef, orderBy('uploadedAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectFile);
}

/**
 * Get the most recently uploaded file for a given group.
 */
export async function getLatestFile(
  userId: string,
  projectId: string,
  group: FileGroup
): Promise<ProjectFile | null> {
  const files = await getProjectFiles(userId, projectId, group);
  return files.length > 0 ? files[0] : null;
}

/**
 * Load and parse the content of a project file from Firebase Storage.
 */
export async function loadFileContent(storagePath: string, filename: string): Promise<ParsedFile> {
  const blob = await downloadFileFromStorage(storagePath);
  return parseFileFromBlob(blob, filename);
}

/**
 * Delete a project file from both Firestore and Firebase Storage.
 */
export async function deleteProjectFile(
  userId: string,
  projectId: string,
  fileId: string
): Promise<void> {
  const db = getFirebaseDb();
  const fileRef = doc(db, 'users', userId, 'projects', projectId, 'files', fileId);
  const fileDoc = await getDoc(fileRef);

  if (fileDoc.exists()) {
    const storagePath = fileDoc.data().storagePath as string;
    // Delete from Storage first
    await deleteFileFromStorage(storagePath);
    // Then delete Firestore metadata
    await deleteDoc(fileRef);
  }
}

// ========== Output CRUD ==========

/**
 * Save an output XLSX file to the project.
 */
export async function saveOutput(
  userId: string,
  projectId: string,
  featureType: string,
  label: string,
  xlsxBuffer: Uint8Array,
  stats?: Record<string, number>
): Promise<OutputFile> {
  const db = getFirebaseDb();
  const outputId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const filename = `${featureType}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const storagePath = buildOutputPath(userId, projectId, outputId, filename);

  // Upload XLSX to Storage
  const { fileSize } = await uploadXlsxToStorage(storagePath, xlsxBuffer);

  // Save metadata to Firestore
  const output: Omit<OutputFile, 'id'> = {
    featureType,
    label,
    storagePath,
    originalFilename: filename,
    createdAt: Timestamp.now(),
    fileSize,
    stats: stats || {},
  };

  const outputRef = doc(db, 'users', userId, 'projects', projectId, 'outputs', outputId);
  await setDoc(outputRef, output);

  // Update project timestamp
  const projectRef = doc(db, 'users', userId, 'projects', projectId);
  await setDoc(projectRef, { updatedAt: serverTimestamp() }, { merge: true });

  return { id: outputId, ...output };
}

/**
 * Get all outputs for a project, sorted by createdAt desc.
 */
export async function getOutputs(userId: string, projectId: string): Promise<OutputFile[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'users', userId, 'projects', projectId, 'outputs'),
    orderBy('createdAt', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }) as OutputFile);
}

/**
 * Delete an output from both Firestore and Firebase Storage.
 */
export async function deleteOutput(
  userId: string,
  projectId: string,
  outputId: string
): Promise<void> {
  const db = getFirebaseDb();
  const outputRef = doc(db, 'users', userId, 'projects', projectId, 'outputs', outputId);
  const outputDoc = await getDoc(outputRef);

  if (outputDoc.exists()) {
    const storagePath = outputDoc.data().storagePath as string;
    await deleteFileFromStorage(storagePath);
    await deleteDoc(outputRef);
  }
}

/**
 * Download an output file as a Blob.
 */
export async function downloadOutputFile(storagePath: string): Promise<Blob> {
  return downloadFileFromStorage(storagePath);
}

// ========== Edpuzzle Config (stored as field on project document) ==========

/**
 * Save an Edpuzzle question-count config for a project.
 * Stored as a map field `edpuzzleConfigs` on the project document (keyed by clip count).
 * Uses setDoc merge so no extra subcollection permissions are needed.
 */
export async function saveEdpuzzleConfig(
  userId: string,
  projectId: string,
  config: { totalClips: number; clipQuestions: number[]; label: string }
): Promise<EdpuzzleConfig> {
  const db = getFirebaseDb();
  const projectRef = doc(db, 'users', userId, 'projects', projectId);
  const configKey = `clips_${config.totalClips}`;

  const data: EdpuzzleConfig = {
    id: configKey,
    totalClips: config.totalClips,
    clipQuestions: config.clipQuestions,
    label: config.label,
    savedAt: Timestamp.now(),
  };

  // Merge into the project doc under edpuzzleConfigs map
  await setDoc(projectRef, {
    edpuzzleConfigs: { [configKey]: data },
    updatedAt: serverTimestamp(),
  }, { merge: true });

  return data;
}

/**
 * Load a saved Edpuzzle config matching a specific totalClips count.
 * Reads from the `edpuzzleConfigs` map field on the project document.
 */
export async function loadEdpuzzleConfig(
  userId: string,
  projectId: string,
  totalClips: number
): Promise<EdpuzzleConfig | null> {
  const db = getFirebaseDb();
  const projectRef = doc(db, 'users', userId, 'projects', projectId);
  const snapshot = await getDoc(projectRef);
  if (!snapshot.exists()) return null;

  const configs = snapshot.data().edpuzzleConfigs as Record<string, EdpuzzleConfig> | undefined;
  if (!configs) return null;

  const configKey = `clips_${totalClips}`;
  return configs[configKey] || null;
}
