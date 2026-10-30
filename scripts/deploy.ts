// Deploy the built site to an S3 bucket served by CloudFront, keeping every released version online:
//   yarn build && node scripts/deploy.ts --bucket BUCKET --distribution ID [--force] [--dry]
// The build goes to v/<version>/ (where its seed codes keep making the same games) and to the site's root, and the
// version joins versions.json, which the root page reads to send an old seed link to its version (main.ts). Needs the
// AWS CLI, signed in. --force re-deploys a version already listed (a version's seeds must not change: fixes only).

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { GENERATOR_VERSION } from '../src/core/generate.ts';

const { values } = parseArgs({
  options: {
    bucket: { type: 'string' },
    distribution: { type: 'string' },
    force: { type: 'boolean' },
    dry: { type: 'boolean' },
  },
});
if (!values.bucket || !values.distribution) {
  console.error('usage: node scripts/deploy.ts --bucket BUCKET --distribution ID [--force] [--dry]');
  process.exit(2);
}
if (!existsSync('dist/index.html')) throw new Error('no build: run yarn build first');
const s3 = `s3://${values.bucket}`;
const version = GENERATOR_VERSION;

const aws = (args: string[], quiet = false) => {
  console.log(`aws ${args.join(' ')}`);
  if (values.dry && !quiet) return '';
  return execFileSync('aws', args, { encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'ignore'] : 'inherit' }) ?? '';
};

// the versions online
let versions: string[] = [];
try {
  versions = JSON.parse(aws(['s3', 'cp', `${s3}/versions.json`, '-'], true));
} catch {
  // none yet: the first deploy
}
if (versions.includes(version) && !values.force)
  throw new Error(`v${version} is already online (--force to replace it)`);

// hashed assets cache for good; the pages and the version list are checked every time
const ASSETS = ['--cache-control', 'public, max-age=31536000, immutable'];
const PAGES = ['--cache-control', 'no-cache'];
const upload = (to: string, extra: string[] = []) => {
  aws(['s3', 'sync', 'dist/assets', `${to}/assets`, ...ASSETS]);
  aws(['s3', 'sync', 'dist', to, '--exclude', 'assets/*', ...PAGES, ...extra]);
};
upload(`${s3}/v/${version}`);
upload(s3, ['--exclude', 'v/*', '--exclude', 'versions.json']);

const list = [...new Set([...versions, version])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
console.log(`versions.json: ${JSON.stringify(list)}`);
if (!values.dry) {
  execFileSync('aws', ['s3', 'cp', '-', `${s3}/versions.json`, '--content-type', 'application/json', ...PAGES], {
    input: JSON.stringify(list),
    stdio: ['pipe', 'inherit', 'inherit'],
  });
}
aws([
  'cloudfront',
  'create-invalidation',
  '--distribution-id',
  values.distribution,
  '--paths',
  '/',
  '/index.html',
  '/versions.json',
  `/v/${version}/*`,
]);
console.log(`deployed v${version}`);
