export interface AppVersion {
  version: string;
  url: string;
  releaseNotes: string;
}

export async function checkUpdate(currentVersion: string): Promise<{ shouldUpdate: boolean; data?: AppVersion }> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`);
    if (!response.ok) throw new Error('Failed to fetch version');
    const data: AppVersion = await response.json();
    
    // Comparación simple de versiones (ej: "1.0.0" vs "1.0.1")
    const isNewer = data.version !== currentVersion;
    
    return {
      shouldUpdate: isNewer,
      data: isNewer ? data : undefined
    };
  } catch (error) {
    console.error('Update check failed:', error);
    return { shouldUpdate: false };
  }
}
