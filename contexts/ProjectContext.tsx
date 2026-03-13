'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import {
  getProject,
  getProjectFiles,
  getOutputs,
  uploadProjectFile as uploadProjectFileSvc,
  deleteProjectFile as deleteProjectFileSvc,
  deleteOutput as deleteOutputSvc,
  saveOutput as saveOutputSvc,
  loadFileContent as loadFileContentSvc,
  downloadOutputFile,
  saveEdpuzzleConfig as saveEdpuzzleConfigSvc,
  loadEdpuzzleConfig as loadEdpuzzleConfigSvc,
} from '@/lib/project-service';
import { parseXlsxBlob } from '@/lib/xlsx-utils';
import type { Project, ProjectFile, OutputFile, FileGroup, ParsedFile, EdpuzzleConfig } from '@/types';

interface ProjectContextType {
  project: Project | null;
  files: {
    canvas: ProjectFile[];
    registrar: ProjectFile[];
    score: ProjectFile[];
  };
  outputs: OutputFile[];
  loading: boolean;
  uploadFile: (group: FileGroup, file: File) => Promise<ProjectFile>;
  deleteFile: (fileId: string) => Promise<void>;
  loadFileContent: (file: ProjectFile) => Promise<ParsedFile>;
  getDefaultFile: (group: FileGroup) => ProjectFile | null;
  saveOutput: (featureType: string, label: string, xlsxBuffer: Uint8Array, stats?: Record<string, number>) => Promise<OutputFile>;
  deleteOutput: (outputId: string) => Promise<void>;
  downloadOutput: (output: OutputFile) => Promise<void>;
  loadOutputContent: (output: OutputFile) => Promise<{ headers: string[]; rows: string[][] }>;
  refreshFiles: () => Promise<void>;
  refreshOutputs: () => Promise<void>;
  saveEdpuzzleConfig: (config: { totalClips: number; clipQuestions: number[]; label: string }) => Promise<EdpuzzleConfig>;
  loadEdpuzzleConfig: (totalClips: number) => Promise<EdpuzzleConfig | null>;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export function useProject(): ProjectContextType {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return ctx;
}

interface ProjectProviderProps {
  projectId: string;
  children: React.ReactNode;
}

export function ProjectProvider({ projectId, children }: ProjectProviderProps) {
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<{
    canvas: ProjectFile[];
    registrar: ProjectFile[];
    score: ProjectFile[];
  }>({ canvas: [], registrar: [], score: [] });
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = user?.uid;

  // Load project data
  const loadProject = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const proj = await getProject(userId, projectId);
      setProject(proj);

      // Load files grouped
      const allFiles = await getProjectFiles(userId, projectId);
      setFiles({
        canvas: allFiles.filter((f) => f.group === 'canvas'),
        registrar: allFiles.filter((f) => f.group === 'registrar'),
        score: allFiles.filter((f) => f.group === 'score'),
      });

      // Load outputs
      const allOutputs = await getOutputs(userId, projectId);
      setOutputs(allOutputs);
    } catch (error) {
      console.error('Error loading project:', error);
    } finally {
      setLoading(false);
    }
  }, [userId, projectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Refresh just files
  const refreshFiles = useCallback(async () => {
    if (!userId) return;
    const allFiles = await getProjectFiles(userId, projectId);
    setFiles({
      canvas: allFiles.filter((f) => f.group === 'canvas'),
      registrar: allFiles.filter((f) => f.group === 'registrar'),
      score: allFiles.filter((f) => f.group === 'score'),
    });
  }, [userId, projectId]);

  // Refresh just outputs
  const refreshOutputs = useCallback(async () => {
    if (!userId) return;
    const allOutputs = await getOutputs(userId, projectId);
    setOutputs(allOutputs);
  }, [userId, projectId]);

  // Upload a file
  const uploadFile = useCallback(async (group: FileGroup, file: File): Promise<ProjectFile> => {
    if (!userId) throw new Error('Not authenticated');
    const result = await uploadProjectFileSvc(userId, projectId, group, file);
    await refreshFiles();
    return result;
  }, [userId, projectId, refreshFiles]);

  // Delete a file
  const deleteFile = useCallback(async (fileId: string): Promise<void> => {
    if (!userId) return;
    await deleteProjectFileSvc(userId, projectId, fileId);
    await refreshFiles();
  }, [userId, projectId, refreshFiles]);

  // Load file content (download + parse)
  const loadFileContent = useCallback(async (file: ProjectFile): Promise<ParsedFile> => {
    return loadFileContentSvc(file.storagePath, file.originalFilename);
  }, []);

  // Get default (most recent) file for a group
  const getDefaultFile = useCallback((group: FileGroup): ProjectFile | null => {
    const groupFiles = files[group];
    return groupFiles.length > 0 ? groupFiles[0] : null; // Already sorted by uploadedAt desc
  }, [files]);

  // Save output
  const saveOutputFn = useCallback(async (
    featureType: string,
    label: string,
    xlsxBuffer: Uint8Array,
    stats?: Record<string, number>
  ): Promise<OutputFile> => {
    if (!userId) throw new Error('Not authenticated');
    const result = await saveOutputSvc(userId, projectId, featureType, label, xlsxBuffer, stats);
    await refreshOutputs();
    return result;
  }, [userId, projectId, refreshOutputs]);

  // Delete output
  const deleteOutputFn = useCallback(async (outputId: string): Promise<void> => {
    if (!userId) return;
    await deleteOutputSvc(userId, projectId, outputId);
    await refreshOutputs();
  }, [userId, projectId, refreshOutputs]);

  // Download output file
  const downloadOutput = useCallback(async (output: OutputFile): Promise<void> => {
    const blob = await downloadOutputFile(output.storagePath);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = output.originalFilename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  // Load output content (download + parse XLSX)
  const loadOutputContent = useCallback(async (output: OutputFile): Promise<{ headers: string[]; rows: string[][] }> => {
    const blob = await downloadOutputFile(output.storagePath);
    return parseXlsxBlob(blob);
  }, []);

  // Save Edpuzzle config
  const saveEdpuzzleConfig = useCallback(async (
    config: { totalClips: number; clipQuestions: number[]; label: string }
  ): Promise<EdpuzzleConfig> => {
    if (!userId) throw new Error('Not authenticated');
    return saveEdpuzzleConfigSvc(userId, projectId, config);
  }, [userId, projectId]);

  // Load Edpuzzle config
  const loadEdpuzzleConfig = useCallback(async (totalClips: number): Promise<EdpuzzleConfig | null> => {
    if (!userId) return null;
    return loadEdpuzzleConfigSvc(userId, projectId, totalClips);
  }, [userId, projectId]);

  return (
    <ProjectContext.Provider
      value={{
        project,
        files,
        outputs,
        loading,
        uploadFile,
        deleteFile,
        loadFileContent,
        getDefaultFile,
        saveOutput: saveOutputFn,
        deleteOutput: deleteOutputFn,
        downloadOutput,
        loadOutputContent,
        refreshFiles,
        refreshOutputs,
        saveEdpuzzleConfig,
        loadEdpuzzleConfig,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
