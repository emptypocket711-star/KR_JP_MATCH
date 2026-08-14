export type HanaFirebaseEnvironment = 'staging' | 'production';

export interface FunctionsDeploymentContract {
  environment: HanaFirebaseEnvironment;
  projectId: string;
  region: 'us-central1' | 'asia-northeast1';
}

export interface ResolveFunctionsDeploymentInput {
  declaredProjectId?: unknown;
  runtimeProjectId?: unknown;
  environment?: unknown;
  explicitRegion?: unknown;
}

const contracts: readonly FunctionsDeploymentContract[] = [
  {
    environment: 'staging',
    projectId: 'hana-e2ee6',
    region: 'us-central1',
  },
  {
    environment: 'production',
    projectId: 'hana-production-tokyo',
    region: 'asia-northeast1',
  },
];

function normalizedOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function contractForProject(projectId: string): FunctionsDeploymentContract {
  const contract = contracts.find((candidate) => candidate.projectId === projectId);
  if (!contract) {
    throw new Error(`Unsupported Hana Firebase project "${projectId}".`);
  }
  return contract;
}

function contractForEnvironment(
  environment: string
): FunctionsDeploymentContract {
  const contract = contracts.find(
    (candidate) => candidate.environment === environment
  );
  if (!contract) {
    throw new Error(`Unsupported Hana Firebase environment "${environment}".`);
  }
  return contract;
}

/**
 * Resolves one exact project/environment/region tuple and rejects drift.
 *
 * The explicit values are provided by the guarded deploy scripts. A deployed
 * runtime can resolve from its Firebase/GCP project ID alone because arbitrary
 * shell variables used by the deploy command are not guaranteed to persist.
 */
export function resolveFunctionsDeployment(
  input: ResolveFunctionsDeploymentInput
): FunctionsDeploymentContract {
  const declaredProjectId = normalizedOptionalString(input.declaredProjectId);
  const runtimeProjectId = normalizedOptionalString(input.runtimeProjectId);
  const environment = normalizedOptionalString(input.environment);
  const explicitRegion = normalizedOptionalString(input.explicitRegion);

  const candidates: FunctionsDeploymentContract[] = [];
  if (declaredProjectId) {
    candidates.push(contractForProject(declaredProjectId));
  }
  if (runtimeProjectId) {
    candidates.push(contractForProject(runtimeProjectId));
  }
  if (environment) {
    candidates.push(contractForEnvironment(environment));
  }

  if (candidates.length === 0) {
    throw new Error(
      'Cannot resolve Hana Functions deployment without a known project or environment.'
    );
  }

  const resolved = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.projectId !== resolved.projectId) {
      throw new Error(
        'Hana Functions deployment project/environment values do not match.'
      );
    }
  }

  if (explicitRegion && explicitRegion !== resolved.region) {
    throw new Error(
      `Hana Functions region mismatch for ${resolved.environment}: ` +
        `expected "${resolved.region}", found "${explicitRegion}".`
    );
  }

  return resolved;
}

export function projectIdFromFirebaseConfig(rawConfig: unknown): string | null {
  const normalized = normalizedOptionalString(rawConfig);
  if (!normalized) {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(normalized);
  } catch {
    throw new Error('FIREBASE_CONFIG is not valid JSON.');
  }

  if (!decoded || typeof decoded !== 'object') {
    throw new Error('FIREBASE_CONFIG must be a JSON object.');
  }

  const projectId = normalizedOptionalString(
    (decoded as Record<string, unknown>).projectId
  );
  if (!projectId) {
    throw new Error('FIREBASE_CONFIG does not contain a projectId.');
  }
  return projectId;
}
