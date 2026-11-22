import {
  Activity, Archive, ArrowLeftRight, Bell, Braces, CheckCheck, Database, FileCode, Globe, HeartPulse, KeyRound,
  LayoutDashboard, Lock, LogIn, Mail, Monitor, QrCode, ShieldCheck, Trash2, Upload,
} from 'lucide-react';

// Data for the "How it works" page (/how-it-works): the architecture
// diagram (boxes, arrows), the request traces, and the stack by layer.
// Coordinates are in the diagram's 990 x 600 viewBox; every box is 150 wide.

export const NODE_W = 150;
export const NODE_H = 54;

export const LANES = [
  { label: 'CLIENT', x: 85 },
  { label: 'EDGE', x: 270 },
  { label: 'LAMBDA · PYTHON 3.13', x: 470 },
  { label: 'DATA', x: 690 },
  { label: 'BACKGROUND', x: 905 },
];

export const NODES = {
  browser: {
    x: 10, y: 230, title: 'Browser', sub: ['React 19 app'], icon: Monitor,
    tag: 'React 19 · Vite 8 · Tailwind CSS 4',
    text: 'The app you are looking at. It calls the API with a Bearer token and sends file bytes straight to S3.',
    facts: [
      'Files over 100 MB go up in parts, four at a time, with up to four retries per part.',
      'Unfinished uploads are remembered, so adding the same file again resumes it.',
      'Tokens renew a minute before they expire, and again when a tab wakes from sleep.',
    ],
    paths: ['web/src/pages', 'web/src/context/AuthContext.jsx'],
  },
  amplify: {
    x: 195, y: 104, title: 'Amplify', sub: ['static hosting'], icon: Globe,
    tag: 'AWS Amplify Hosting',
    text: 'Serves the built React app as static files. The deploy script builds it with the API URL baked in, then publishes it here.',
    facts: ['S3 + CloudFront is built in as the alternative (web_hosting = "cloudfront").'],
    paths: ['terraform/web.tf', 'terraform/deploy.sh'],
  },
  apigw: {
    x: 195, y: 230, title: 'API Gateway', sub: ['REST · /v1'], icon: ArrowLeftRight,
    tag: 'Amazon API Gateway · REST API',
    text: 'The one front door for every API call. Protected routes run the authorizer before any function code.',
    facts: [
      'The authorizer’s answer is cached per token for 5 minutes, so most requests skip it.',
      '/v1/d/{code} is public, so share links work without an account.',
    ],
    paths: ['terraform/apigateway.tf', 'terraform/modules/api-lambda-route'],
  },
  authsvc: {
    x: 395, y: 34, title: 'Auth service', sub: ['sign-up · login'], icon: KeyRound,
    tag: 'AWS Lambda · Python 3.13',
    text: 'Sign-up, sign-in, user info and token refresh. A small built-in service, so there is nothing else to set up.',
    facts: [
      'Passwords are hashed with PBKDF2-SHA256, 200,000 rounds.',
      'Tokens are HMAC-SHA256 signed and carry their own expiry, so no sessions are stored.',
      'ID and access tokens last 1 hour; refresh tokens last 30 days.',
    ],
    paths: ['endpoints/auth-service', 'terraform/auth.tf'],
  },
  authorizer: {
    x: 395, y: 104, title: 'Authorizer', sub: ['checks tokens'], icon: ShieldCheck,
    tag: 'API Gateway Lambda authorizer',
    text: 'Checks the token in front of every file route, then reads the account, so deleted, suspended or signed-out accounts are turned away.',
    facts: ['Every token carries the account’s token_version. Signing out everywhere bumps it.'],
    paths: ['endpoints/authorizer', 'terraform/authorizer.tf'],
  },
  files: {
    x: 395, y: 174, h: 96, title: 'File functions', sub: ['upload · finish', 'list · download', 'share · delete'], icon: Braces,
    tag: '6 Lambda functions · Python 3.13',
    text: 'One function per job: start an upload, finish it, list files, download, share by email and delete. Shared code ships once as a Lambda layer.',
    facts: [
      'Parts are at least 16 MB and big enough to stay under S3’s 10,000-part limit.',
      'The storage quota is enforced with one conditional DynamoDB update, so parallel uploads can’t slip past it.',
      'Listing uses a DynamoDB index, never a table scan.',
    ],
    paths: ['endpoints/upload-file', 'endpoints/complete-upload', 'endpoints/share-file', 'terraform/lambda.tf'],
  },
  qr: {
    x: 395, y: 288, title: 'Links service', sub: ['short links'], icon: QrCode,
    tag: 'AWS Lambda · Python 3.13',
    text: 'Makes the short links behind email, copy and QR sharing, keeps their download stats, turns them off, and answers /d/{code}.',
    facts: [
      'A presigned S3 URL is about 1,500 characters, too dense for a QR code. A 12-character code is stored instead.',
      'Each visit gets a fresh 5-minute download URL. That is what lets a link last 7 days, or forever.',
      'Download limits use a conditional update, so two people can’t both take the last download.',
    ],
    paths: ['endpoints/qr-link', 'endpoints/common/python/links.py'],
  },
  admin: {
    x: 395, y: 358, title: 'Admin API', sub: ['admins only'], icon: LayoutDashboard,
    tag: 'AWS Lambda · its own IAM role',
    text: 'The API behind the admin panel: totals and charts, every account, file and link, an audit log and a live Health page.',
    facts: [
      'The only role allowed to scan tables and read CloudWatch.',
      'Every change is written to an audit item kept for a year.',
    ],
    paths: ['endpoints/admin', 'terraform/admin.tf'],
  },
  users: {
    x: 615, y: 34, title: 'Users table', sub: ['DynamoDB'], icon: Database,
    tag: 'Amazon DynamoDB · on-demand',
    text: 'One item per account: name, email, password hash, role, suspended flag, token version and storage limit.',
    facts: [],
    paths: ['terraform/auth.tf'],
  },
  filesdb: {
    x: 615, y: 116, h: 66, title: 'Files table', sub: ['DynamoDB', 'files · links'], icon: Database,
    tag: 'Amazon DynamoDB · on-demand',
    text: 'A single table for files, short links, storage usage, daily stats and audit items.',
    facts: [
      'Two sparse indexes: user → files and file → links.',
      'TTL removes unfinished uploads after a day and expired links 30 days after they expire.',
      'Its stream triggers the cleanup function.',
    ],
    paths: ['terraform/dynamodb.tf'],
  },
  kms: {
    x: 615, y: 206, title: 'KMS', sub: ['encryption keys'], icon: Lock,
    tag: 'AWS KMS · optional',
    text: 'Encryption at rest, picked with one setting.',
    facts: [
      'Default: SSE-S3 (AES-256), free.',
      'Shared: one customer-managed key, about $1 a month.',
      'Per user: one key per user, made on their first upload.',
    ],
    paths: ['terraform/kms.tf'],
  },
  ses: {
    x: 615, y: 278, title: 'SES', sub: ['share emails'], icon: Mail,
    tag: 'Amazon SES',
    text: 'Sends share emails. Each recipient gets their own short link, so you can see who downloaded.',
    facts: [],
    paths: ['terraform/ses.tf'],
  },
  s3: {
    x: 615, y: 430, title: 'S3 bucket', sub: ['private · SSE'], icon: Archive,
    tag: 'Amazon S3 · private bucket',
    text: 'Holds the file bytes. Nothing is public; every read and write uses a short-lived presigned URL.',
    facts: [
      'Browsers upload and download directly, so file bytes never pass through Lambda.',
      'Multipart uploads remove the 5 GB single-upload limit.',
    ],
    paths: ['terraform/s3.tf'],
  },
  cleanup: {
    x: 830, y: 280, title: 'Cleanup', sub: ['stale uploads'], icon: Trash2,
    tag: 'AWS Lambda · DynamoDB stream',
    text: 'When TTL deletes the record of an upload that never finished, this function aborts the multipart upload or deletes the partial file.',
    facts: [],
    paths: ['endpoints/cleanup', 'terraform/cleanup.tf'],
  },
  cw: {
    x: 395, y: 536, title: 'CloudWatch', sub: ['logs · alarms'], icon: Activity,
    tag: 'Amazon CloudWatch',
    text: 'Logs and metrics for every function, plus alarms for Lambda errors, API 5xx responses and 4xx spikes.',
    facts: [],
    paths: ['terraform/monitoring.tf'],
  },
  monitor: {
    x: 615, y: 536, title: 'Monitor', sub: ['health · 5 min'], icon: HeartPulse,
    tag: 'AWS Lambda · EventBridge schedule',
    text: 'Emails errors from the logs within seconds, and runs the health checks every 5 minutes.',
    facts: ['Emails when something breaks and again when it’s fixed.'],
    paths: ['endpoints/admin/src/monitor.py'],
  },
  sns: {
    x: 830, y: 536, title: 'SNS', sub: ['alert emails'], icon: Bell,
    tag: 'Amazon SNS',
    text: 'One topic that delivers every alert by email: log errors, failed health checks, alarms and failed deploys.',
    facts: [],
    paths: ['terraform/monitoring.tf'],
  },
};

// Functions whose logs feed CloudWatch (drawn as one arrow).
export const COMPUTE = ['authsvc', 'authorizer', 'files', 'qr', 'admin', 'cleanup'];

export const EDGES = [
  { id: 'browser-amplify', from: 'browser', to: 'amplify', d: 'M85 230 V143 Q85 131 97 131 H195' },
  { id: 'browser-apigw', from: 'browser', to: 'apigw', d: 'M160 257 H195' },
  { id: 'apigw-authsvc', from: 'apigw', to: 'authsvc', d: 'M345 244 C372 244 368 61 395 61' },
  { id: 'apigw-authorizer', from: 'apigw', to: 'authorizer', d: 'M345 249 C372 249 368 131 395 131' },
  { id: 'apigw-files', from: 'apigw', to: 'files', d: 'M345 256 C372 256 368 222 395 222' },
  { id: 'apigw-qr', from: 'apigw', to: 'qr', d: 'M345 264 C372 264 368 315 395 315' },
  { id: 'apigw-admin', from: 'apigw', to: 'admin', d: 'M345 270 C372 270 368 385 395 385' },
  { id: 'authsvc-users', from: 'authsvc', to: 'users', d: 'M545 61 H615' },
  { id: 'authorizer-users', from: 'authorizer', to: 'users', d: 'M545 131 C580 131 580 72 615 72' },
  { id: 'files-filesdb', from: 'files', to: 'filesdb', d: 'M545 196 C580 196 580 152 615 152' },
  { id: 'files-kms', from: 'files', to: 'kms', d: 'M545 222 C580 222 580 233 615 233' },
  { id: 'files-ses', from: 'files', to: 'ses', d: 'M545 240 C580 240 580 305 615 305' },
  { id: 'files-s3', from: 'files', to: 's3', d: 'M545 258 C585 258 575 444 615 444' },
  { id: 'qr-filesdb', from: 'qr', to: 'filesdb', d: 'M545 306 C585 306 575 164 615 164' },
  { id: 'qr-s3', from: 'qr', to: 's3', d: 'M545 322 C585 322 575 455 615 455' },
  { id: 'admin-users', from: 'admin', to: 'users', d: 'M545 370 C592 370 568 50 615 50' },
  { id: 'admin-filesdb', from: 'admin', to: 'filesdb', d: 'M545 380 C592 380 568 175 615 175' },
  { id: 'admin-s3', from: 'admin', to: 's3', d: 'M545 398 C585 398 575 468 615 468' },
  { id: 'browser-s3', from: 'browser', to: 's3', d: 'M85 284 V494 Q85 506 97 506 H678 Q690 506 690 494 V484',
    label: { x: 100, y: 499, text: 'presigned PUT / GET · file bytes skip Lambda' } },
  { id: 'filesdb-cleanup', from: 'filesdb', to: 'cleanup', d: 'M765 149 C905 149 905 200 905 280',
    label: { x: 912, y: 222, text: 'TTL stream' } },
  { id: 'cleanup-s3', from: 'cleanup', to: 's3', d: 'M905 334 C905 420 830 457 765 457' },
  { id: 'lambdas-cw', from: COMPUTE, to: 'cw', d: 'M470 412 V536',
    label: { x: 478, y: 527, text: 'logs from every function' } },
  { id: 'cw-monitor', from: 'cw', to: 'monitor', d: 'M545 563 H615' },
  { id: 'monitor-sns', from: 'monitor', to: 'sns', d: 'M765 563 H830' },
];

// Boxes and arrows linked to one box, for hover and selection.
export function neighbors(id) {
  const nodes = new Set();
  const edges = [];
  for (const e of EDGES) {
    const froms = [].concat(e.from);
    if (froms.includes(id)) { edges.push(e.id); nodes.add(e.to); }
    else if (e.to === id) { edges.push(e.id); froms.forEach((f) => nodes.add(f)); }
  }
  nodes.delete(id);
  return { nodes: [...nodes], edges };
}

export const FLOWS = [
  {
    id: 'upload', name: 'Upload a big file', icon: Upload, steps: [
      { nodes: ['browser', 'apigw', 'authorizer', 'users'], edges: ['browser-apigw', 'apigw-authorizer', 'authorizer-users'],
        text: 'You add a file. The authorizer checks your token and that your account is still active.' },
      { nodes: ['apigw', 'files', 'filesdb'], edges: ['apigw-files', 'files-filesdb'],
        text: 'A file record is saved with a one-day expiry, and an S3 multipart upload starts because the file is over 100 MB.' },
      { nodes: ['files', 's3'], edges: ['files-s3'],
        text: 'The function signs upload URLs for the parts, a batch at a time.' },
      { nodes: ['browser', 's3'], edges: ['browser-s3'],
        text: 'Your browser sends the parts straight to S3, four at a time, retrying any that fail. No bytes pass through Lambda.' },
      { nodes: ['browser', 'apigw', 'files', 's3', 'filesdb'], edges: ['browser-apigw', 'apigw-files', 'files-s3', 'files-filesdb'],
        text: 'S3 joins the parts, the size is counted against your storage quota, and the file is marked ready.' },
    ],
  },
  {
    id: 'qr', name: 'Share by QR code', icon: QrCode, steps: [
      { nodes: ['browser', 'apigw', 'authorizer', 'qr'], edges: ['browser-apigw', 'apigw-authorizer', 'apigw-qr'],
        text: 'You pick how long the link works and an optional download limit.' },
      { nodes: ['qr', 'filesdb'], edges: ['qr-filesdb'],
        text: 'The links service stores a 12-character code, and the app draws it as a QR code.' },
      { nodes: ['browser', 'apigw', 'qr'], edges: ['browser-apigw', 'apigw-qr'],
        text: 'Someone scans it and opens /d/{code}. No account needed.' },
      { nodes: ['qr', 'filesdb'], edges: ['qr-filesdb'],
        text: 'The link is checked: not expired, not turned off, and under its download limit. Then the download is counted.' },
      { nodes: ['qr', 's3', 'browser'], edges: ['qr-s3', 'browser-s3'],
        text: 'A fresh 5-minute download URL is signed, and the file comes straight from S3.' },
    ],
  },
  {
    id: 'email', name: 'Share by email', icon: Mail, steps: [
      { nodes: ['browser', 'apigw', 'authorizer', 'files'], edges: ['browser-apigw', 'apigw-authorizer', 'apigw-files'],
        text: 'You enter the recipients, an expiry and an optional download limit.' },
      { nodes: ['files', 'filesdb'], edges: ['files-filesdb'],
        text: 'One short link is made per recipient, so the stats show who downloaded.' },
      { nodes: ['files', 'ses'], edges: ['files-ses'],
        text: 'SES emails each person their own link.' },
    ],
  },
  {
    id: 'signin', name: 'Sign in', icon: LogIn, steps: [
      { nodes: ['browser', 'apigw'], edges: ['browser-apigw'],
        text: 'You enter your email and password.' },
      { nodes: ['apigw', 'authsvc'], edges: ['apigw-authsvc'],
        text: 'API Gateway passes them to the auth service. This route needs no token.' },
      { nodes: ['authsvc', 'users'], edges: ['authsvc-users'],
        text: 'Your password is checked against its PBKDF2 hash (200,000 rounds).' },
      { nodes: ['browser', 'apigw', 'authsvc'], edges: ['browser-apigw', 'apigw-authsvc'],
        text: 'Signed tokens come back. The app renews them quietly for up to 30 days.' },
    ],
  },
  {
    id: 'cleanup', name: 'Clean up a stale upload', icon: Trash2, steps: [
      { nodes: ['filesdb'], edges: [],
        text: 'An upload is never finished. A day later, DynamoDB deletes its record on its own.' },
      { nodes: ['filesdb', 'cleanup'], edges: ['filesdb-cleanup'],
        text: 'The deletion shows up on the table’s stream, which wakes the cleanup function.' },
      { nodes: ['cleanup', 's3'], edges: ['cleanup-s3'],
        text: 'It aborts the multipart upload or deletes the partial file. Nothing is left behind.' },
    ],
  },
  {
    id: 'alert', name: 'Email an error alert', icon: Bell, steps: [
      { nodes: [...COMPUTE, 'cw'], edges: ['lambdas-cw'],
        text: 'A function logs an error, times out or crashes.' },
      { nodes: ['cw', 'monitor'], edges: ['cw-monitor'],
        text: 'CloudWatch hands the error to the monitor function within seconds.' },
      { nodes: ['monitor', 'sns'], edges: ['monitor-sns'],
        text: 'The monitor emails the error, its cause and a link to the logs, at most once per function every 15 minutes.' },
    ],
  },
];

export const PRINCIPLES = [
  { title: 'File bytes skip Lambda.', text: 'Browsers upload and download straight to S3 with presigned URLs.' },
  { title: 'No stored sessions.', text: 'Tokens are signed and carry their own expiry.' },
  { title: 'Short links, not raw S3 URLs.', text: 'A 12-character code gets a fresh download URL on every visit.' },
  { title: 'Your requests never scan.', text: 'Two DynamoDB indexes answer every list you see.' },
];

export const FACTS = [
  { value: '12', label: 'Lambda functions' },
  { value: '2', label: 'DynamoDB tables' },
  { value: '22', label: 'Terraform files' },
  { value: '$0–1', label: 'a month to run' },
];

export const LAYERS = [
  { name: 'Front end', icon: Monitor, tools: [
    { name: 'React', version: '19' }, { name: 'Vite', version: '8' }, { name: 'Tailwind CSS', version: '4' },
    { name: 'React Router', version: '7' }, { name: 'qrcode.react', version: '4' },
  ] },
  { name: 'API & compute', icon: Braces, tools: [
    { name: 'API Gateway', version: 'REST', node: 'apigw' }, { name: 'Lambda', version: 'Python 3.13', node: 'files' },
    { name: 'Authorizer', version: '5 min cache', node: 'authorizer' }, { name: 'Auth service', version: 'PBKDF2', node: 'authsvc' },
    { name: 'boto3', version: 'AWS SDK' },
  ] },
  { name: 'Data & storage', icon: Database, tools: [
    { name: 'DynamoDB', version: 'on-demand', node: 'filesdb' }, { name: 'S3', version: 'private', node: 's3' },
    { name: 'KMS', version: 'optional', node: 'kms' }, { name: 'SES', version: 'email', node: 'ses' },
  ] },
  { name: 'Infrastructure', icon: FileCode, tools: [
    { name: 'Terraform', version: '≥ 1.5' }, { name: 'Amplify', version: 'hosting', node: 'amplify' },
    { name: 'deploy.sh', version: 'one command' }, { name: 'LocalStack', version: 'offline' },
  ] },
  { name: 'Quality & ops', icon: CheckCheck, tools: [
    { name: 'pytest + moto', version: 'tests' }, { name: 'Ruff', version: 'lint' }, { name: 'GitHub Actions', version: 'CI' },
    { name: 'CloudWatch', version: 'logs', node: 'cw' }, { name: 'SNS', version: 'alerts', node: 'sns' },
  ] },
];
