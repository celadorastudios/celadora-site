/* Secret and PII scan for everything this repo publishes.
 *
 * GitHub Pages serves this repo verbatim, so "committed" and "published to
 * the internet" are the same event. There is no build step to strip anything
 * out, and no undo: a push is a disclosure.
 *
 * Two jobs, because they fail differently:
 *
 *   1. Credentials. gitleaks covers this better than anything hand-rolled and
 *      runs alongside in CI; the patterns here are a cheap zero-dependency
 *      backstop that works with no network and no install.
 *
 *   2. The owner's own personal data. This is the part gitleaks does NOT do.
 *      The legal pages deliberately identify the studio by trade name and one
 *      published address, and a personal name, home address or private email
 *      slipping into a commit is the specific harm we designed those pages to
 *      avoid. Detection is by SHAPE, never by listing the private values —
 *      writing them here to grep for them would leak them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'assets', '_ds']);
const SKIP_FILES = new Set(['package-lock.json', 'support.js', 'favicon.ico', 'favicon.svg']);
const TEXT = /\.(html|css|js|mjs|json|md|txt|xml|yml|yaml)$/;

/* Values that are public ON PURPOSE. Each needs a reason, because an
   allowlist is how a scanner quietly stops working. */
const ALLOWED = [
  'hello@celadora.net',                                  // the published contact address
  'phc_rG8EyAG2i9JPyBVi7fUqxYpy5ZqqoqjKJXXqL3TZozgt',    // PostHog project key: a write-only client key, public by design
  'cf54d1f7a85e4f868e264c4f6b7748fd',                    // Cloudflare Web Analytics beacon token: public by design
  'noreply@anthropic.com',                               // commit trailer
];

const RULES = [
  // --- credentials -------------------------------------------------------
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, note: 'private key block' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/, note: 'GitHub token' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/, note: 'AWS access key id' },
  { id: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/, note: 'Slack token' },
  { id: 'stripe-key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/, note: 'Stripe key' },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/, note: 'Google API key' },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/, note: 'OpenAI-style key' },
  { id: 'posthog-personal', re: /\bphx_[A-Za-z0-9]{20,}\b/, note: 'PostHog PERSONAL api key (not the public project key)' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, note: 'JWT' },
  {
    id: 'assigned-secret',
    re: /\b(?:api[_-]?key|secret|passwd|password|token|auth)\s*[:=]\s*["'][^"'\s]{12,}["']/i,
    note: 'hard-coded credential'
  },

  // --- the owner's personal data ----------------------------------------
  { id: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, note: 'email address' },
  { id: 'phone-us', re: /(?:\+1[-. ]?)?\(?\b[2-9]\d{2}\)?[-. ]\d{3}[-. ]\d{4}\b/, note: 'US phone number' },
  {
    id: 'street-address',
    re: /\b\d{1,5}\s+[A-Z][A-Za-z.]*(?:\s+[A-Z][A-Za-z.]*)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd|Way|Terrace|Ter|Circle|Cir)\b\.?/,
    note: 'street address'
  },
  { id: 'us-zip-line', re: /\b(?:NH|New Hampshire)[,\s]+\d{5}(?:-\d{4})?\b/, note: 'address with ZIP' },
  { id: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/, note: 'SSN-shaped number' },
];

function files(dir = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...files(rel));
    } else if (TEXT.test(e.name) && !SKIP_FILES.has(e.name)) {
      out.push(rel);
    }
  }
  return out;
}

const hits = [];
const scanned = files();

for (const rel of scanned) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    // Self-exempt: this file necessarily contains the patterns themselves.
    if (rel === 'scripts/check-secrets.mjs') return;
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      if (ALLOWED.some((a) => m[0].includes(a) || line.includes(a))) continue;
      hits.push({ rel, line: i + 1, rule, found: m[0] });
    }
  });
}

/* Redact before printing. A CI log is as public as the repo, so a scanner
   that echoes the secret it caught has just published it a second time. */
function redact(s) {
  if (s.length <= 8) return '*'.repeat(s.length);
  return s.slice(0, 3) + '*'.repeat(Math.min(s.length - 6, 20)) + s.slice(-3);
}

if (hits.length === 0) {
  console.log(`secrets: OK (${scanned.length} text files scanned, ${RULES.length} rules)`);
  process.exit(0);
}

console.error(`secrets: ${hits.length} finding(s)\n`);
for (const h of hits) {
  console.error(`  ${h.rel}:${h.line}  [${h.rule.id}] ${h.rule.note}`);
  console.error(`      ${redact(h.found)}`);
}
console.error('\nIf a finding is intentional and safe to publish, add it to ALLOWED');
console.error('in scripts/check-secrets.mjs with a comment saying why.');
process.exit(1);
