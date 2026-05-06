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
  saveEdpuzzleConfigs as saveEdpuzzleConfigsSvc,
  loadEdpuzzleConfig as loadEdpuzzleConfigSvc,
  loadAllEdpuzzleConfigs as loadAllEdpuzzleConfigsSvc,
  deleteEdpuzzleConfig as deleteEdpuzzleConfigSvc,
} from '@/lib/project-service';
import { parseXlsxBlob } from '@/lib/xlsx-utils';
import { parseMasterDataBuffer } from '@/lib/master-data-utils';
import type { Project, ProjectFile, OutputFile, FileGroup, ParsedFile, EdpuzzleConfig, ParsedMasterData } from '@/types';

interface ProjectContextType {
  project: Project | null;
  files: {
    canvas: ProjectFile[];
    registrar: ProjectFile[];
    score: ProjectFile[];
    edpuzzle: ProjectFile[];
    master: ProjectFile[];
  };
  outputs: OutputFile[];
  loading: boolean;
  uploadFile: (group: FileGroup, file: File) => Promise<ProjectFile>;
  deleteFile: (fileId: string) => Promise<void>;
  loadFileContent: (file: ProjectFile) => Promise<ParsedFile>;
  loadMasterData: () => Promise<ParsedMasterData | null>;
  saveOutput: (featureType: string, label: string, xlsxBuffer: Uint8Array, stats?: Record<string, number>) => Promise<OutputFile>;
  deleteOutput: (outputId: string) => Promise<void>;
  downloadOutput: (output: OutputFile) => Promise<void>;
  loadOutputContent: (output: OutputFile) => Promise<{ headers: string[]; rows: string[][] }>;
  refreshFiles: () => Promise<void>;
  refreshOutputs: () => Promise<void>;
  saveEdpuzzleConfig: (config: { totalClips: number; clipQuestions: number[]; label: string; playlistName?: string }) => Promise<EdpuzzleConfig>;
  saveEdpuzzleConfigs: (configs: Array<{ totalClips: number; clipQuestions: number[]; label: string; playlistName: string }>) => Promise<number>;
  loadEdpuzzleConfig: (totalClips: number) => Promise<EdpuzzleConfig | null>;
  loadAllEdpuzzleConfigs: () => Promise<EdpuzzleConfig[]>;
  deleteEdpuzzleConfig: (configId: string) => Promise<void>;
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
    edpuzzle: ProjectFile[];
    master: ProjectFile[];
  }>({ canvas: [], registrar: [], score: [], edpuzzle: [], master: [] });
  const [masterDataCache, setMasterDataCache] = useState<ParsedMasterData | null>(null);
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
        edpuzzle: allFiles.filter((f) => f.group === 'edpuzzle'),
        master: allFiles.filter((f) => f.group === 'master'),
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
      edpuzzle: allFiles.filter((f) => f.group === 'edpuzzle'),
      master: allFiles.filter((f) => f.group === 'master'),
    });
    setMasterDataCache(null); // Invalidate cache when files refresh
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

  // Load and cache master data from the latest master file
  const loadMasterData = useCallback(async (): Promise<ParsedMasterData | null> => {
    if (masterDataCache) return masterDataCache;
    const masterFiles = files.master;
    if (masterFiles.length === 0) return null;
    try {
      const latestFile = masterFiles[0]; // Already sorted by uploadedAt desc
      const blob = await downloadOutputFile(latestFile.storagePath);
      const buffer = new Uint8Array(await blob.arrayBuffer());
      const parsed = parseMasterDataBuffer(buffer);
      setMasterDataCache(parsed);
      return parsed;
    } catch (err) {
      console.error('Error loading master data:', err);
      return null;
    }
  }, [files.master, masterDataCache]);

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
    config: { totalClips: number; clipQuestions: number[]; label: string; playlistName?: string }
  ): Promise<EdpuzzleConfig> => {
    if (!userId) throw new Error('Not authenticated');
    return saveEdpuzzleConfigSvc(userId, projectId, config);
  }, [userId, projectId]);

  // Batch save multiple Edpuzzle configs
  const saveEdpuzzleConfigs = useCallback(async (
    configs: Array<{ totalClips: number; clipQuestions: number[]; label: string; playlistName: string }>
  ): Promise<number> => {
    if (!userId) throw new Error('Not authenticated');
    return saveEdpuzzleConfigsSvc(userId, projectId, configs);
  }, [userId, projectId]);

  // Load Edpuzzle config
  const loadEdpuzzleConfig = useCallback(async (totalClips: number): Promise<EdpuzzleConfig | null> => {
    if (!userId) return null;
    return loadEdpuzzleConfigSvc(userId, projectId, totalClips);
  }, [userId, projectId]);

  // Load all Edpuzzle configs
  const loadAllEdpuzzleConfigs = useCallback(async (): Promise<EdpuzzleConfig[]> => {
    if (!userId) return [];
    return loadAllEdpuzzleConfigsSvc(userId, projectId);
  }, [userId, projectId]);

  // Delete an Edpuzzle config
  const deleteEdpuzzleConfig = useCallback(async (configId: string): Promise<void> => {
    if (!userId) return;
    await deleteEdpuzzleConfigSvc(userId, projectId, configId);
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
        loadMasterData,
        saveOutput: saveOutputFn,
        deleteOutput: deleteOutputFn,
        downloadOutput,
        loadOutputContent,
        refreshFiles,
        refreshOutputs,
        saveEdpuzzleConfig,
        saveEdpuzzleConfigs,
        loadEdpuzzleConfig,
        loadAllEdpuzzleConfigs,
        deleteEdpuzzleConfig,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}
