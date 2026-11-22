import { Clock, FileCode, FolderArchive, HardDrive, Layers, Link2, Settings2, UserCog } from 'lucide-react';
import { NODES } from '../how-it-works/architecture';

// Data for the deploy guide's resource map: what `terraform apply` creates in
// your AWS account, grouped by job, with the Terraform resource types and the
// file each one is declared in. Icons and names match the How it works diagram
// (../how-it-works/architecture.js) so the two pages read as one.

export const LOCAL = [
  { icon: Settings2, name: 'terraform.tfvars', text: 'Your settings: region, sender email, admins. Never committed.' },
  { icon: FileCode, name: 'Terraform + providers', text: 'aws, random, archive and null, downloaded by terraform init.' },
  { icon: HardDrive, name: 'terraform.tfstate', text: 'Terraform’s record of what exists, including the token-signing secret.' },
  { icon: FolderArchive, name: 'build/', text: 'Function and layer zips, made during plan and apply.' },
];

export const PIPELINE = [
  { name: 'terraform apply', text: 'creates or updates everything below' },
  { name: 'vite build', text: 'bakes the new API URL into the web app' },
  { name: 'publish', text: 'uploads the build to Amplify as a zip' },
  { name: 'health check', text: 'runs the monitor Lambda once' },
];

export const GROUPS = [
  {
    name: 'Front door',
    items: [
      {
        id: 'amplify', icon: NODES.amplify.icon, name: 'Amplify app', count: '1 app · 1 branch',
        text: 'Static hosting for the React build at https://<branch>.<app-id>.amplifyapp.com. It is not connected to a Git repository: deploy.sh uploads a ready-built zip, so Amplify never runs a build itself.',
        types: ['aws_amplify_app', 'aws_amplify_branch'],
        notes: [
          'custom_headers adds the Content-Security-Policy, HSTS and no-framing headers to every response.',
          'A custom_rule serves index.html for any path without a file extension, so /app and /deploy work on reload.',
          'Set web_hosting = "cloudfront" to use a private S3 bucket + CloudFront instead (new accounts need AWS Support to verify them first).',
        ],
        files: ['terraform/web.tf'], hiw: 'amplify',
      },
      {
        id: 'apigw', icon: NODES.apigw.icon, name: 'API Gateway', count: 'REST API · stage',
        text: 'One regional REST API. Every route is a resource + method + AWS_PROXY integration + a permission that lets API Gateway invoke the Lambda. A small module stamps those out for each route.',
        types: ['aws_api_gateway_rest_api', 'aws_api_gateway_resource', 'aws_api_gateway_method', 'aws_api_gateway_integration',
          'aws_api_gateway_deployment', 'aws_api_gateway_stage', 'aws_api_gateway_method_settings', 'aws_lambda_permission'],
        notes: [
          'The stage is named after environment, so the URL ends in /dev by default.',
          'The deployment has a trigger hashing the API files, so changing a route redeploys the stage.',
          'Stage-wide throttling: api_throttle_rate and api_throttle_burst.',
        ],
        files: ['terraform/apigateway.tf', 'terraform/modules/api-lambda-route', 'terraform/modules/cors-options'], hiw: 'apigw',
      },
      {
        id: 'authorizer', icon: NODES.authorizer.icon, name: 'Token authorizer', count: 'TOKEN type',
        text: 'A Lambda authorizer that API Gateway runs before any protected route. It reads the Authorization header, and API Gateway caches its answer per token.',
        types: ['aws_api_gateway_authorizer', 'aws_lambda_function', 'aws_api_gateway_gateway_response'],
        notes: [
          'identity_validation_expression rejects headers that are not "Bearer <token>" without invoking the Lambda at all.',
          'authorizer_cache_seconds (300) is how long a valid answer is reused.',
          'Gateway responses add CORS headers to API Gateway’s own 401s, so the browser can see them and renew the session.',
        ],
        files: ['terraform/authorizer.tf'], hiw: 'authorizer',
      },
      {
        id: 'domain', icon: Link2, name: 'Custom API domain', count: 'optional',
        text: 'Only created when api_domain_name is set: an ACM certificate validated through DNS records in your Route 53 zone, a regional custom domain and an alias record.',
        types: ['aws_acm_certificate', 'aws_acm_certificate_validation', 'aws_route53_record', 'aws_api_gateway_domain_name', 'aws_api_gateway_base_path_mapping'],
        notes: ['Needs route53_zone_id. Leave both empty to use the default execute-api URL.'],
        files: ['terraform/domain.tf'],
      },
    ],
  },
  {
    name: 'Compute',
    items: [
      {
        id: 'lambdas', icon: NODES.files.icon, name: 'Lambda functions', count: '12 functions',
        text: 'Seven functions (the six file functions and cleanup) come from one for_each block over local.functions; auth, links (qr), admin, authorizer and monitor are declared in their own files. All run Python 3.13.',
        types: ['aws_lambda_function', 'data.archive_file', 'aws_lambda_permission'],
        notes: [
          'archive_file zips endpoints/<name>/src at plan time. Its hash is the function’s source_code_hash, so only changed code is redeployed.',
          'Memory is 512 MB for most functions and 1024 MB for auth: Lambda gives CPU in proportion to memory, and password hashing is CPU-bound.',
          'Each function gets environment variables (table, bucket, limits) straight from Terraform.',
        ],
        files: ['terraform/locals.tf', 'terraform/lambda.tf', 'terraform/auth.tf', 'terraform/qr.tf', 'terraform/admin.tf'], hiw: 'files',
      },
      {
        id: 'layers', icon: Layers, name: 'Lambda layers', count: '2 layers',
        text: 'Code shared by every function (endpoints/common) ships once as a layer. A second layer holds the jsonschema package, which two functions need.',
        types: ['aws_lambda_layer_version', 'null_resource', 'data.archive_file'],
        notes: [
          'Lambda puts a layer’s python/ folder on the import path, so handlers simply `import storage`.',
          'jsonschema has compiled dependencies, so build.sh asks pip for Linux (manylinux) wheels whatever your own OS is.',
          'Terraform cannot run pip, so a null_resource runs build.sh with local-exec during apply.',
        ],
        files: ['terraform/layers.tf', 'terraform/build.sh', 'endpoints/common'],
      },
      {
        id: 'iam', icon: UserCog, name: 'IAM roles', count: '3 roles',
        text: 'Roles the functions assume. Most share one role scoped to this app’s bucket and table; admin and monitor each get their own, because only they may scan tables or read CloudWatch.',
        types: ['aws_iam_role', 'aws_iam_role_policy', 'aws_iam_role_policy_attachment'],
        notes: [
          'The trust policy lets lambda.amazonaws.com assume the role; the inline policy says what it may do.',
          'Sending email is limited with a condition on ses:FromAddress = sender_email.',
          'KMS permissions are only added when kms_mode is not "s3".',
        ],
        files: ['terraform/iam.tf', 'terraform/admin.tf', 'terraform/monitoring.tf'],
      },
    ],
  },
  {
    name: 'Data',
    items: [
      {
        id: 'dynamodb', icon: NODES.filesdb.icon, name: 'DynamoDB tables', count: '4 tables',
        text: 'Files (with links, usage and audit items), users, rate limits and the monitor’s alert state. All on-demand, so you pay per request and nothing when idle.',
        types: ['aws_dynamodb_table'],
        notes: [
          'The files table has two global secondary indexes (user-files, file-links), TTL on `ttl`, and a stream of deleted items.',
          'Files and users have point-in-time recovery: restore to any second of the last 35 days.',
        ],
        files: ['terraform/dynamodb.tf', 'terraform/auth.tf', 'terraform/ratelimit.tf'], hiw: 'filesdb',
      },
      {
        id: 's3', icon: NODES.s3.icon, name: 'S3 files bucket', count: '1 bucket',
        text: 'Holds every uploaded file. Named <app>-<env>-files-<account id> unless you set files_bucket_name, because bucket names are global across all of AWS.',
        types: ['aws_s3_bucket', 'aws_s3_bucket_public_access_block', 'aws_s3_bucket_ownership_controls',
          'aws_s3_bucket_server_side_encryption_configuration', 'aws_s3_bucket_lifecycle_configuration',
          'aws_s3_bucket_cors_configuration', 'aws_s3_bucket_policy'],
        notes: [
          'force_destroy = true: terraform destroy empties and deletes it, files included.',
          'CORS allows browser PUT and GET from the hosted app plus allowed_origins, and exposes ETag for multipart uploads.',
          'A bucket policy refuses any request that is not over HTTPS.',
        ],
        files: ['terraform/s3.tf'], hiw: 's3',
      },
      {
        id: 'kms', icon: NODES.kms.icon, name: 'KMS key', count: 'optional',
        text: 'Created only with kms_mode = "shared". With "per_user", the upload Lambda makes one key per user at run time, outside Terraform.',
        types: ['aws_kms_key', 'aws_kms_alias', 'null_resource'],
        notes: [
          'Because per-user keys are not in the state, a destroy-time null_resource runs cleanup_kms.sh to schedule their deletion.',
          'AWS waits at least 7 days before deleting a key.',
        ],
        files: ['terraform/kms.tf', 'terraform/cleanup_kms.sh'], hiw: 'kms',
      },
      {
        id: 'ses', icon: NODES.ses.icon, name: 'SES identity', count: '1 email',
        text: 'Registers sender_email with Amazon SES. AWS emails that address a verification link, and nothing is sent until it is clicked.',
        types: ['aws_ses_email_identity'],
        notes: ['New accounts start in the SES sandbox: you can only send to verified addresses until you request production access.'],
        files: ['terraform/ses.tf'], hiw: 'ses',
      },
    ],
  },
  {
    name: 'Operations',
    items: [
      {
        id: 'logs', icon: NODES.cw.icon, name: 'CloudWatch', count: '12 log groups · 13 alarms',
        text: 'A log group per function, kept 14 days, and alarms on Lambda errors, API 5xx and 4xx spikes.',
        types: ['aws_cloudwatch_log_group', 'aws_cloudwatch_metric_alarm', 'aws_cloudwatch_log_subscription_filter'],
        notes: [
          'Terraform creates each log group before its function, so it owns the group and deletes it on destroy.',
          'Subscription filters pass ERROR lines from every log group to the monitor Lambda.',
        ],
        files: ['terraform/monitoring.tf'], hiw: 'cw',
      },
      {
        id: 'sns', icon: NODES.sns.icon, name: 'SNS alerts topic', count: '1 topic',
        text: 'One topic for every alert. With alert_email set, Terraform subscribes that address; AWS sends a confirmation link first.',
        types: ['aws_sns_topic', 'aws_sns_topic_subscription'],
        notes: ['deploy.sh publishes to it when a deploy fails.'],
        files: ['terraform/monitoring.tf'], hiw: 'sns',
      },
      {
        id: 'schedule', icon: Clock, name: 'EventBridge schedule', count: 'every 5 min',
        text: 'Runs the monitor’s health check every health_check_minutes. Set it to 0 to turn the schedule off.',
        types: ['aws_cloudwatch_event_rule', 'aws_cloudwatch_event_target', 'aws_lambda_permission'],
        notes: [],
        files: ['terraform/monitoring.tf'], hiw: 'monitor',
      },
      {
        id: 'stream', icon: NODES.cleanup.icon, name: 'Stream trigger', count: '1 mapping',
        text: 'Connects the files table’s stream to the cleanup Lambda, with a filter so it only runs when TTL deletes an unfinished upload.',
        types: ['aws_lambda_event_source_mapping'],
        notes: [],
        files: ['terraform/cleanup.tf'], hiw: 'cleanup',
      },
    ],
  },
];
