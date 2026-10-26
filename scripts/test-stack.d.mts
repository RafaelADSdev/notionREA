export const testWorkdir: string;
export function createTestConfiguration(configuration: string): string;
export function assertTestConfiguration(configuration: string): void;
export function assertTestStatus(status: unknown): void;
export function prepareTestStack(): void;
export function runTestSupabase(args: string[]): import("node:child_process").SpawnSyncReturns<string>;
export function testStackStatus(): { API_URL: string; DB_URL: string; [key: string]: unknown };
export function loadTestEnvironment(): Record<string, string>;
