export interface UpstreamGuardResult {
  namespaced: string[];
  inherited: string[];
  unexpected: string[];
  untouched: string[];
}
export declare function classifyProviderChanges(paths: string[]): UpstreamGuardResult;
export declare function auditWorkingTree(baseline?: string): UpstreamGuardResult;
