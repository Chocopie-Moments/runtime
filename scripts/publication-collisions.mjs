import { execFileSync } from 'node:child_process';

/** Read-only collision admission before any registry or release write. */
export function assertPublicationDestinationsAvailable(packages, repository, tag, execute = execFileSync) {
  for (const [name, pin] of Object.entries(packages)) {
    try {
      execute('npm', ['view', `${name}@${pin.version}`, 'version', '--json', '--registry=https://registry.npmjs.org'], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      let response;
      try { response = JSON.parse(String(error.stdout)); } catch { /* An unstructured failure is not absence. */ }
      if (response?.error?.code === 'E404') continue;
      throw new Error(`Cannot establish registry availability for ${name}@${pin.version}`, { cause: error });
    }
    throw new Error(`Registry version already exists: ${name}@${pin.version}`);
  }
  try {
    execute('gh', ['api', `repos/${repository}/releases/tags/${tag}`], { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    let response;
    try { response = JSON.parse(String(error.stdout)); } catch { /* Reject ambiguous failures. */ }
    if (String(response?.status) === '404') return;
    throw new Error('Cannot establish GitHub release availability', { cause: error });
  }
  throw new Error(`GitHub release already exists: ${tag}`);
}
