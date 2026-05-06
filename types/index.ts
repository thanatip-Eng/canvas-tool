import { Timestamp } from 'firebase/firestore';

// ========== Shared Types ==========

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

export interface AssignmentInfo {
  name: string;
  index: number;
  id: string;
  pointsPossible?: string;
}

// ========== Score Mapping Types ==========

export interface ScoreColumns {
  emailIdx: number;
  idIdx: number;
}

export interface MappingResultEntry {
  rowIndex: number;
  canvasName: string;
  canvasId: string;
  canvasEmail: string;
  status: string;
  matchedScore?: string;
  matchedBy?: string;
  canvasScore?: string;
}

export interface MappingResult {
  assignment: AssignmentInfo;
  results: MappingResultEntry[];
  totalMatched: number;
  totalNotFound: number;
}

// ========== Status Check Types ==========

export interface RegistrarFile {
  filename: string;
  lecSection: string;
  labSection: string;
  courseCode: string;
  data: ParsedFile;
}

export interface CheckEntry {
  id: string;
  name: string;
  surname?: string;
  section: string;
  status: string;
  canvasSection?: string;
}

export interface CheckResult {
  entries: CheckEntry[];
  stats: {
    total: number;
    matched: number;
    canvasOnly: number;
    regOnly: number;
  };
}

// ========== Canvas API Types (from group-exporter) ==========

export interface Course {
  id: number;
  name: string;
  course_code: string;
}

export interface Student {
  id: number;
  name: string;
  sortable_name: string;
  sis_user_id: string;
  login_id: string;
  integration_id: string;
  enrollments: Array<{
    course_section_id: number;
  }>;
}

export interface Section {
  id: number;
  name: string;
}

export interface GroupCategory {
  id: number;
  name: string;
}

export interface Group {
  id: number;
  name: string;
  group_category_id: number;
}

export interface StudentRow {
  name: string;
  sortable_name: string;
  id: number;
  sis_user_id: string;
  login_id: string;
  integration_id: string;
  section: string;
  groups: Record<string, string>;
}

export interface Quiz {
  id: number;
  title: string;
  quiz_type: string;
  published: boolean;
}

export interface Assignment {
  id: number;
  name: string;
  submission_types: string[];
  is_quiz_assignment: boolean;
  is_quiz_lti_assignment: boolean;
  quiz_id?: number;
  is_new_quiz?: boolean;
  external_tool_tag_attributes?: {
    url?: string;
  };
}

export interface ItemResponse {
  itemId: number;
  itemName: string;
  itemType: 'quiz' | 'assignment' | 'new_quiz';
  columns: string[];
  studentData: Map<number, string[]>;
  warning?: string;
}

export interface StudentInfo {
  name: string;
  sis_user_id: string;
  login_id: string;
  section: string;
}

// ========== Grade Comparison Types (NEW) ==========

export interface GradeSnapshot {
  id: string;
  courseId: string;
  courseName: string;
  savedAt: Timestamp;
  headers: string[];
  assignments: AssignmentInfo[];
  students: StudentGrade[];
}

export interface StudentGrade {
  name: string;
  sisId: string;
  email: string;
  section: string;
  scores: Record<string, string>;
}

export interface GradeDiff {
  studentId: string;
  studentName: string;
  section: string;
  oldScore: string | null;
  newScore: string;
  changed: boolean;
  changeType: 'unchanged' | 'increased' | 'decreased' | 'new_student' | 'removed_student' | 'new_score' | 'removed_score';
}

// ========== Project Types ==========

export type FileGroup = 'canvas' | 'registrar' | 'score' | 'edpuzzle' | 'master';

export interface Project {
  id: string;
  canvasCourseId: number;
  courseName: string;
  courseCode: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  edpuzzleConfigs?: Record<string, EdpuzzleConfig>;
}

export interface ProjectFile {
  id: string;
  group: FileGroup;
  originalFilename: string;
  storagePath: string;
  uploadedAt: Timestamp;
  fileSize: number;
  rowCount: number;
  columnCount: number;
  metadata: Record<string, string>;
}

export interface OutputFile {
  id: string;
  featureType: string;
  label: string;
  storagePath: string;
  originalFilename: string;
  createdAt: Timestamp;
  fileSize: number;
  stats: Record<string, number>;
}

// ========== Grade Upload Types ==========

export interface GradeUploadEntry {
  sisUserId: string;
  studentName: string;
  currentScore: string | null;
  newScore: string;
  changeType: 'unchanged' | 'increased' | 'decreased' | 'new_score' | 'blank_to_score';
}

export type UploadMode = 'all' | 'selected' | 'missing-only' | 'changed';
export type ChangeFilter = 'all-changed' | 'increased-only' | 'decreased-only';

export interface GradeUploadResult {
  sisUserId: string;
  success: boolean;
  previousScore: string | null;
  newScore: string;
  error?: string;
}

// ========== Edpuzzle Config Types ==========

export interface EdpuzzleConfig {
  id: string;
  totalClips: number;
  clipQuestions: number[];
  label: string;
  playlistName?: string;
  savedAt: Timestamp;
}

// ========== Master Data Types ==========

export interface MasterAssignment {
  name: string;
  id: string;
  columnIndex: number;
  pointsPossible: number | null;
}

export interface ParsedMasterData {
  headers: string[];
  pointsPossibleRow: string[];
  rows: string[][];
  assignments: MasterAssignment[];
  studentMap: Map<string, number>;
  regOnlyStudents: RegOnlyStudent[];
  sourceInfo: { canvasFileId: string; registrarFileIds: string[] };
}

export interface RegOnlyStudent {
  id: string;
  name: string;
  surname: string;
  regStatus: string;
  section: string;
}

export interface MasterDataStats {
  totalStudents: number;
  matchedCount: number;
  canvasOnlyCount: number;
  regOnlyCount: number;
  assignmentCount: number;
}

// ========== Auth Types ==========

export type FeatureTab = 'groups' | 'responses';

export interface AuthState {
  user: import('firebase/auth').User | null;
  apiKey: string;
  canvasUrl: string;
  loading: boolean;
}
