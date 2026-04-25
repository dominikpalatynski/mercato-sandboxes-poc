// Stub for Coder API client. Task #6 will fill these in.
// Signatures must remain stable so callers (sandbox creation route) can be wired in advance.

export interface CoderUserRef {
  id: string;
  username: string;
}

export interface CoderWorkspaceRef {
  id: string;
}

export interface CoderWorkspaceStatus {
  jobStatus: string;
  agentStatus: string | null;
  lifecycleState: string | null;
  ownerName: string;
  name: string;
}

export interface CoderLinks {
  vscode: string;
  terminal: string;
  splash: string;
  app: string;
}

const NOT_IMPL = 'NOT_IMPLEMENTED — task #6 will fill this in';

export async function ensureCoderUser(_email: string, _password: string): Promise<CoderUserRef> {
  throw new Error(NOT_IMPL);
}

export async function createWorkspace(_coderUserId: string, _name: string): Promise<CoderWorkspaceRef> {
  throw new Error(NOT_IMPL);
}

export async function getWorkspaceStatus(_id: string): Promise<CoderWorkspaceStatus> {
  throw new Error(NOT_IMPL);
}

export function buildLinks(_args: { ownerName: string; name: string }): CoderLinks {
  throw new Error(NOT_IMPL);
}
