import { Link } from 'react-router-dom';
import {
  Archive, ArrowLeftRight, Bell, Braces, Database, FileCode, Globe, KeyRound, Lock, Mail, Puzzle, UserCog,
} from 'lucide-react';
import { REPO_URL } from '../../brand';
import {
  Bullets, C, Code, FileLink, Files, Learn, Note, P, Trouble, Warn,
} from './parts';

// Everything the deploy guide says. Each command, variable and resource here
// comes from terraform/, the README, web/.env.example or the CI workflow, so
// keep it in step with them when they change.

/* ---- Small table --------------------------------------------------------- */

export function Table({ head, rows, className = '' }) {
  const wide = head.length > 2; // three columns need sideways scrolling on a phone
  return (
    <div className={`my-4 overflow-x-auto rounded-lg border border-line ${className}`}>
      <table className={`w-full border-collapse text-left text-sm ${wide ? 'min-w-[560px]' : ''}`}>
        <thead className="bg-surface-2">
          <tr>{head.map((h) => <th key={h} className="border-b border-line px-3.5 py-2.5 font-semibold text-fg">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-b border-line bg-surface last:border-b-0">
              {r.map((cell, j) => (
                <td key={j} className={`px-3.5 py-2.5 align-top leading-relaxed ${j === 0 ? 'text-fg' : 'text-muted'}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---- Concepts ------------------------------------------------------------ */

export const CONCEPTS = [
  {
    icon: FileCode, title: 'Terraform: state, plan and apply',
    text: 'Terraform reads every .tf file in terraform/ as one description of what should exist. It keeps a record of what it has created in terraform.tfstate. plan compares the two and prints the difference; apply makes the AWS API calls to close it.',
    points: [
      'State is local by default (versions.tf). Lose it and Terraform forgets your resources, so keep it safe.',
      'The state also holds the secret that signs session tokens (random_password in auth.tf), in plain text.',
    ],
    files: ['terraform/versions.tf', 'terraform/auth.tf'],
  },
  {
    icon: Puzzle, title: 'Terraform building blocks',
    text: 'Variables are the inputs (variables.tf), your values go in terraform.tfvars, and outputs (outputs.tf) are how deploy.sh reads results back. Modules and for_each turn one block into many resources.',
    points: [
      'modules/api-lambda-route makes the method, integration and permission for every API route.',
      'count = 0 or 1 switches whole features on and off: CloudFront vs Amplify, the shared KMS key, the custom domain.',
      'archive_file zips code; null_resource with local-exec runs scripts Terraform can’t do itself.',
    ],
    files: ['terraform/variables.tf', 'terraform/outputs.tf', 'terraform/modules'],
  },
  {
    icon: Braces, title: 'Lambda and layers',
    text: 'Each Lambda is a zip of one endpoints/<name>/src folder plus a runtime (Python 3.13) and a role. Code that every function shares ships once as a layer, which Lambda unpacks next to the function.',
    points: [
      'Changing a function’s code changes its zip hash (source_code_hash), so only that function is updated.',
      'The jsonschema layer is built with pip for Linux, because Lambda runs on Linux even when you deploy from Windows.',
    ],
    files: ['terraform/lambda.tf', 'terraform/layers.tf', 'terraform/build.sh'],
  },
  {
    icon: ArrowLeftRight, title: 'API Gateway and a custom authorizer',
    text: 'A REST API is a tree of resources (/v1/users/{user_id}/files…) with methods on them. Each method is wired to a Lambda by a proxy integration, and a resource-based permission lets API Gateway invoke it.',
    points: [
      'Protected methods use authorization = "CUSTOM": the token authorizer runs first and its answer is cached.',
      'Changes only go live when a new deployment is made for the stage; a trigger hash in apigateway.tf does that.',
    ],
    files: ['terraform/apigateway.tf', 'terraform/authorizer.tf'],
  },
  {
    icon: Database, title: 'DynamoDB',
    text: 'A key-value database with no server to size. PAY_PER_REQUEST billing charges per read and write, so an idle deployment costs almost nothing.',
    points: [
      'Global secondary indexes let the app query by user or by file instead of scanning.',
      'TTL deletes expired items for free, and the stream lets a Lambda react to those deletions.',
    ],
    files: ['terraform/dynamodb.tf'],
  },
  {
    icon: Archive, title: 'S3 and presigned URLs',
    text: 'The bucket is private. A Lambda signs a URL with its own role’s credentials that allows one PUT or GET on one object for a few minutes, and the browser uses it directly.',
    points: [
      'That is why the bucket needs a CORS rule for the web app’s origin: the browser talks to S3 itself.',
      'A lifecycle rule and the cleanup Lambda remove upload parts that were never finished.',
    ],
    files: ['terraform/s3.tf', 'terraform/cleanup.tf'],
  },
  {
    icon: Lock, title: 'KMS encryption',
    text: 'S3 always encrypts at rest. kms_mode picks the key: S3’s own (free), one customer-managed key, or a key per user. A customer key adds an audit trail and lets you revoke access by disabling it.',
    points: [
      'Per-user keys are made by the app at run time, so Terraform can’t see them: cleanup_kms.sh deletes them on destroy.',
      'Deleting a key always waits at least 7 days.',
    ],
    files: ['terraform/kms.tf', 'terraform/cleanup_kms.sh'],
  },
  {
    icon: UserCog, title: 'IAM: users, roles and policies',
    text: 'Your IAM user is a person with long-lived keys. A role is an identity that a service assumes and gets temporary credentials for. Policies say which actions on which resources are allowed.',
    points: [
      'The functions’ shared role can reach only this app’s bucket and tables (resource-level least privilege).',
      'The admin and monitor Lambdas get separate roles because they need more (scans, CloudWatch).',
    ],
    files: ['terraform/iam.tf', 'terraform/admin.tf'],
  },
  {
    icon: Globe, title: 'Amplify Hosting and build-time config',
    text: 'Amplify serves static files over HTTPS. Here it is used without Git: deploy.sh creates a deployment, uploads a zip to the URL Amplify returns, and starts it.',
    points: [
      'The React app gets its API URL when it is built (VITE_AUTH_URL, VITE_FILE_URL), so the API has to exist first.',
      'Security headers and the single-page-app rewrite rule are set on the Amplify app in web.tf.',
    ],
    files: ['terraform/web.tf', 'terraform/deploy.sh', 'web/src/config.js'],
  },
  {
    icon: Bell, title: 'CloudWatch, SNS and EventBridge',
    text: 'Lambda writes logs to CloudWatch. Alarms watch metrics, subscription filters forward matching log lines, and an EventBridge rule runs the monitor on a schedule. Everything ends up on one SNS topic that emails you.',
    points: [
      'Log groups are declared in Terraform with 14-day retention, so logs don’t pile up forever.',
      'An email subscription to SNS only starts after you confirm it.',
    ],
    files: ['terraform/monitoring.tf'],
  },
  {
    icon: Mail, title: 'SES email',
    text: 'Amazon SES sends email from an address or domain you have proven you own. New accounts are in a sandbox that only sends to verified addresses, at most 200 a day.',
    points: ['Request production access in the SES console to email anyone.'],
    files: ['terraform/ses.tf'],
  },
  {
    icon: KeyRound, title: 'Built-in auth',
    text: 'Accounts, passwords and tokens are handled by a small Lambda and the users table, so there is no Cognito pool to set up. auth_endpoint can point at an external auth service instead.',
    points: ['The authorizer verifies tokens with the same secret, then checks the account is still active.'],
    files: ['terraform/auth.tf', 'endpoints/auth-service'],
  },
];

/* ---- Steps --------------------------------------------------------------- */

const CLONE = `git clone ${REPO_URL}.git
cd dropvault/terraform`;

export const STEPS = [
  {
    id: 'account', title: 'Secure your AWS account',
    body: (
      <>
        <P>
          Everything you create is billed to your own AWS account, so make it safe before you deploy anything. All of
          this happens in the AWS console in your browser.
        </P>
        <Bullets className="mt-4" items={[
          <><span className="font-semibold text-fg">Turn on MFA for the root user</span> (the email address you signed up with), then stop using root for everyday work.</>,
          <><span className="font-semibold text-fg">Create a budget</span> in Billing and Cost Management → Budgets. The zero-spend template, or a monthly budget of a few dollars, emails you as soon as something costs money.</>,
          <><span className="font-semibold text-fg">Create an IAM user for yourself</span> in IAM → Users. On a personal learning account, attach <C>AdministratorAccess</C>: Terraform creates IAM roles, Lambdas and much more, so it needs broad rights. Turn on MFA for this user too.</>,
          <><span className="font-semibold text-fg">Create an access key</span> for that user (use case: Command Line Interface). The secret is shown once; you’ll paste it in step 3.</>,
          <><span className="font-semibold text-fg">Choose one region</span> close to you. Everything goes there (<C>aws_region</C>). The example settings use <C>ap-south-1</C>; the default in <C>variables.tf</C> is <C>eu-west-1</C>.</>,
        ]} />
        <Warn>
          <p>An access key is as good as a password. Never put it in a <C>.tf</C> or <C>.tfvars</C> file, a commit or a chat.
            The AWS CLI keeps it in <C>%USERPROFILE%\.aws\credentials</C>, which is the only place it needs to be.</p>
        </Warn>
        <Learn>
          <p>The root user can do anything, including closing the account; an IAM user can only do what its policies allow.
            The roles Terraform will create for the Lambdas are a third kind of identity: no password and no keys, just
            temporary credentials AWS hands to the service. You’ll see all three in the IAM console.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'tools', title: 'Install the tools',
    body: (
      <>
        <P>
          Five tools, all installable with <C>winget</C>, which comes with Windows 11. <C>versions.tf</C> needs
          Terraform 1.5 or newer, and the README asks for Node 20 or newer.
        </P>
        <Code shell="powershell">{`
winget install --id Git.Git -e
winget install --id Hashicorp.Terraform -e
winget install --id Amazon.AWSCLI -e
winget install --id Python.Python.3.13 -e
winget install --id OpenJS.NodeJS.LTS -e
`}</Code>
        <P>Close the terminal and open a new one so it picks up the new <C>PATH</C>, then check each tool answers:</P>
        <Code shell="powershell">{`
git --version
terraform -version
aws --version
python --version
node --version
`}</Code>
        <Note title="Two terminals">
          <p>Git for Windows includes <span className="font-medium text-fg">Git Bash</span>, which runs <C>deploy.sh</C> and
            the other scripts. Every code block on this page says where it runs: PowerShell or Git Bash.</p>
        </Note>
        <Warn>
          <p>If <C>python</C> opens the Microsoft Store, turn off the <C>python.exe</C> and <C>python3.exe</C> entries in
            Settings → Apps → Advanced app settings → App execution aliases, then open a new terminal.</p>
        </Warn>
        <Learn>
          <p>Terraform turns the <C>.tf</C> files into AWS API calls. The AWS CLI is what <C>deploy.sh</C> uses to upload
            the site to Amplify and run the health check. Python runs pip to build the jsonschema layer and zips the site.
            Node builds the React app. Bash runs the scripts.</p>
          <p>Your Python doesn’t have to match Lambda’s: <C>build.sh</C> asks pip for Python 3.13 Linux wheels whatever
            you have installed.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'cli', title: 'Connect the AWS CLI',
    body: (
      <>
        <P>Give the CLI the access key from step 1. It asks for the key ID, the secret, your region and an output format (<C>json</C>).</P>
        <Code shell="powershell">aws configure</Code>
        <P>Then ask AWS who you are. You should see your account ID and your IAM user’s ARN, not root.</P>
        <Code shell="powershell">aws sts get-caller-identity</Code>
        <Note title="Using a named profile">
          <p>If you keep several accounts, run <C>aws configure --profile dropvault</C> instead and set
            {' '}<C>aws_profile = "dropvault"</C> in step 5. The Terraform provider, <C>deploy.sh</C>,
            {' '}<C>admin-account.sh</C> and <C>cleanup_kms.sh</C> all read it.</p>
        </Note>
        <Learn>
          <p>Terraform’s AWS provider, the CLI and boto3 all look for credentials in the same places: environment
            variables first, then <C>.aws\credentials</C>. That chain is why no <C>.tf</C> file contains a key, and why
            {' '}<C>aws_profile = ""</C> simply means “use the default”.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'code', title: 'Get the code',
    body: (
      <>
        <P>Clone the repository somewhere you’ll keep, and move into the Terraform folder. Fork it first if you plan to change the code.</P>
        <Code shell="bash">{CLONE}</Code>
        <P>What’s inside, from the deploy’s point of view:</P>
        <Bullets className="mt-3" items={[
          <><C>endpoints/</C>: one folder per Lambda. Only each <C>src/</C> folder is zipped and deployed.</>,
          <><C>endpoints/common/python/</C>: code every function imports, deployed as the shared layer.</>,
          <><C>terraform/</C>: all the infrastructure, the scripts, and two small modules.</>,
          <><C>web/</C>: the React app that <C>deploy.sh</C> builds and publishes.</>,
        ]} />
        <Files className="mt-4" paths={['endpoints', 'terraform', 'web']} />
        <Learn>
          <p>Terraform treats every <C>.tf</C> file in a folder as one configuration, so splitting <C>s3.tf</C>,
            {' '}<C>lambda.tf</C> and <C>web.tf</C> apart is only for people reading it. The order doesn’t matter either:
            Terraform works out what depends on what from the references between resources.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'tfvars', title: 'Fill in terraform.tfvars',
    body: (
      <>
        <P>Copy the example settings, then open <C>terraform.tfvars</C> in your editor.</P>
        <Code shell="bash" where="terraform/">cp terraform.tfvars.example terraform.tfvars</Code>
        <P>For a first deploy from Windows, these are the lines to set. Leave everything else as it is.</P>
        <Code shell="file" title="terraform.tfvars" where="terraform/">{`
aws_region  = "ap-south-1"   # your region from step 1
aws_profile = ""             # or the profile name from step 3

app_name    = "enclave"      # prefix of every resource name
environment = "dev"          # also the API stage name

sender_email = "you@example.com"

web_hosting = "amplify"
kms_mode    = "s3"

admin_emails = ["you@example.com"]
alert_email  = "you@example.com"

bash_bin   = "C:/Program Files/Git/bin/bash.exe"
python_bin = "python"
`}</Code>
        <Table head={['Variable', 'What it does']} rows={[
          [<C>sender_email</C>, 'Required (no default). The address share emails come from. AWS emails it a verification link.'],
          [<><C>app_name</C>, <C>environment</C></>, <>Every resource is named <C>{'<app_name>-<environment>-…'}</C>, e.g. the function <C>enclave-dev-monitor</C>.</>],
          [<C>web_hosting</C>, <><C>amplify</C> works on new accounts. <C>cloudfront</C> needs AWS Support to verify the account first.</>],
          [<C>kms_mode</C>, <><C>s3</C> (free), <C>shared</C> (one key, about $1 a month) or <C>per_user</C> (about $1 per user a month).</>],
          [<C>admin_emails</C>, 'Owner admins, in lowercase. Needed for step 9.'],
          [<C>alert_email</C>, 'Where alerts go: errors, failed health checks, alarms, failed deploys. Empty = no email.'],
          [<><C>bash_bin</C>, <C>python_bin</C></>, 'Windows only: Terraform runs build.sh and cleanup_kms.sh with these. The defaults (/bin/bash, python3) don’t exist on Windows.'],
          [<C>allowed_origins</C>, <>Extra origins allowed to upload to S3. <C>http://localhost:3001</C> is already there for local development.</>],
        ]} />
        <P>Every other setting (quota, rate limits, alert timing, a custom API domain) is described in <FileLink path="terraform/variables.tf" />.</P>
        <Warn>
          <p><C>deploy.sh</C> and <C>admin-account.sh</C> read <C>aws_region</C>, <C>aws_profile</C> and <C>python_bin</C> with
            a simple text match. Keep each on its own line, starting with the name, with the value in double quotes, as in the example.</p>
        </Warn>
        <Note title="Keep it out of Git">
          <p><C>terraform.tfvars</C> is listed in <C>.gitignore</C>, along with the state files and <C>build/</C>. Leave it
            that way: it holds your email addresses and account choices.</p>
        </Note>
        <Learn>
          <p><C>variables.tf</C> declares each input with a type, a default and sometimes a validation rule. Your
            {' '}<C>.tfvars</C> file supplies the values, passed in with <C>-var-file</C>. A wrong value, such as an uppercase
            address in <C>admin_emails</C> or <C>kms_mode = "aes"</C>, is refused by the validation before anything is
            created. <C>sender_email</C> has no default, so Terraform won’t run without it.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'plan', title: 'Preview with terraform plan',
    body: (
      <>
        <P>
          Before creating anything, ask Terraform what it would do. <C>init</C> downloads the providers;
          {' '}<C>plan</C> prints every resource it would create, ending with a line like
          {' '}<C>Plan: … to add, 0 to change, 0 to destroy.</C> Nothing in AWS changes yet.
        </P>
        <Code shell="bash" where="terraform/">{`
terraform init
terraform plan -var-file=terraform.tfvars
`}</Code>
        <P>Scroll through it. You’ll find each piece of the resource map above: <C>aws_lambda_function.fn["list"]</C>,
          {' '}<C>aws_dynamodb_table.files</C>, <C>aws_amplify_app.web[0]</C> and so on.</P>
        <Note>
          <p>Plan already writes the function zips into <C>build/functions/</C>, because <C>archive_file</C> runs while
            planning. The jsonschema layer is built during apply. The Makefile has the same commands as
            {' '}<C>make init</C> and <C>make plan</C>, if you have <C>make</C> (Git Bash doesn’t include it).</p>
        </Note>
        <Learn>
          <p>Terraform compares three things: your configuration, the state file, and what AWS reports right now. On the
            first run the state is empty, so everything is <C>+ create</C>. Later, plan shows <C>~ update</C>,
            {' '}<C>-/+ replace</C> or <C>- destroy</C>, and a run with nothing to do says <C>No changes.</C> Make plan a habit
            whenever you edit a <C>.tf</C> file or your settings.</p>
          <p><C>init</C> also writes <C>.terraform.lock.hcl</C>, which pins the exact provider versions it picked within
            the ranges in <C>versions.tf</C> (<C>{'aws ~> 5.0'}</C> and others).</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'deploy', title: 'Deploy with deploy.sh',
    body: (
      <>
        <P>One command does the whole deploy. Run it in Git Bash, from the Terraform folder.</P>
        <Code shell="bash" where="terraform/">bash deploy.sh</Code>
        <P>Here is what it does, in order:</P>
        <ol className="mt-3 space-y-2.5">
          {[
            <><C>terraform init -upgrade</C>, then <C>terraform apply -auto-approve -var-file=terraform.tfvars</C>. This is the long part on the first run.</>,
            <>Reads the results with <C>terraform output -raw</C>: <C>api_url</C>, <C>web_url</C>, <C>amplify_app_id</C>, <C>monitor_function</C> and more.</>,
            <>Builds <C>web/</C> with <C>VITE_AUTH_URL</C> and <C>VITE_FILE_URL</C> set to the API URL (running <C>npm ci</C> first if there’s no <C>node_modules</C>).</>,
            <>Zips <C>web/dist</C> with Python, then <C>aws amplify create-deployment</C>, uploads the zip with <C>curl</C>, <C>start-deployment</C>, and checks <C>get-job</C> every 5 seconds until it succeeds.</>,
            <>Invokes the monitor Lambda once and prints its health checks.</>,
          ].map((t, k) => (
            <li key={k} className="grid grid-cols-[24px_1fr] gap-2.5 text-[15px] leading-relaxed text-muted">
              <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full border border-line-strong font-mono text-[11px] text-subtle">{k + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        <P className="mt-4">It ends by printing your addresses:</P>
        <Code shell="output">{`
Deployed.
  Web app : https://main.<app-id>.amplifyapp.com
  API     : https://<api-id>.execute-api.<region>.amazonaws.com/dev
  Admin   : https://main.<app-id>.amplifyapp.com/admin  (first time, or forgot the password: bash terraform/admin-account.sh)
`}</Code>
        <Warn>
          <p><C>deploy.sh</C> applies with <C>-auto-approve</C>: it doesn’t stop to show you the plan. That’s what step 6 is for.
            If it stops with an error, it emails the alerts topic; running it again is safe and carries on from where Terraform got to.</p>
        </Warn>
        <Learn>
          <p>The React app has no settings file at run time: Vite writes the API URL into the JavaScript when it builds
            (<C>web/src/config.js</C> reads <C>import.meta.env.VITE_AUTH_URL</C>). So the order is fixed: create the API,
            read its URL from a Terraform output, build, publish. Outputs are the contract between Terraform and the
            scripts around it.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'emails', title: 'Confirm the AWS emails',
    body: (
      <>
        <P>The first deploy makes AWS send up to two emails. Both need a click, and nothing in Terraform can do it for you.</P>
        <Bullets className="mt-4" items={[
          <><span className="font-semibold text-fg">To <C>sender_email</C>:</span> an Amazon SES verification link. Until you click it, SES won’t send as that address.</>,
          <><span className="font-semibold text-fg">To <C>alert_email</C>:</span> an SNS subscription confirmation. Until you confirm it, alerts don’t reach you.</>,
        ]} />
        <Note title="The SES sandbox">
          <p>A new account can only send email to verified addresses, 200 a day. Request production access in the SES
            console to email anyone. Copy-link and QR sharing don’t use SES at all.</p>
          <p>Share by email appears in the web app by itself once AWS approves production access: the API checks SES
            every few minutes. To force it on or off, set <C>email_sharing</C> in <C>terraform.tfvars</C>.</p>
        </Note>
        <Learn>
          <p>Both clicks are proof of consent. SES needs to know you own the From address before it sends as it, and SNS
            won’t email anyone who didn’t opt in. Infrastructure as code can create the resources, but some steps stay human.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'admin', title: 'Create your admin account',
    body: (
      <>
        <P>With your address in <C>admin_emails</C> and the stack deployed, create the account from the command line:</P>
        <Code shell="bash" where="terraform/">bash admin-account.sh</Code>
        <Code shell="output">{`
Created the account of you@example.com.
  Temporary password: <shown here>
  Sign in with it, then change it under your name in the sidebar (Change password).
`}</Code>
        <P>Sign in on your web app with that password and change it. <span className="font-medium text-fg">Admin</span> then
          appears in the sidebar. To print the link:</P>
        <Code shell="bash" where="terraform/">terraform output admin_url</Code>
        <P>The script takes the first address in <C>admin_emails</C>. To pick one and set a name:
          {' '}<C>bash admin-account.sh you@example.com "Your Name"</C>. Run it again any time to reset a forgotten password;
          that also signs out every session of the account.</P>
        <Note>
          <p>Added your address to <C>admin_emails</C> after deploying? Run <C>bash deploy.sh</C> first: the list reaches the
            Lambdas as the <C>ADMIN_EMAILS</C> environment variable.</p>
        </Note>
        <Learn>
          <p>Why not just sign up on the website? There’s no email verification, so whoever registered an owner address
            first would become an admin. Instead the script calls the auth Lambda directly with <C>aws lambda invoke</C>,
            which only someone with credentials for your AWS account can do. Direct invocations skip API Gateway, and the
            handler tells them apart because API Gateway events always include <C>httpMethod</C>.</p>
        </Learn>
      </>
    ),
  },
  {
    id: 'verify', title: 'Check that it works',
    body: (
      <>
        <P>Start with the health check at the end of the deploy output. Each line is <C>ok</C>, <C>warning</C>,
          {' '}<C>error</C> or <C>unknown</C>, followed by an overall status.</P>
        <Code shell="output">{`
==> health check
    ok       <check>: <summary>
    ...
    overall: ok
`}</Code>
        <P>Then use it the way a visitor would:</P>
        <Bullets className="mt-3" items={[
          'Open the web app, create an account, and upload a small file.',
          'Copy a share link for it and open the link in a private window.',
          'Open /admin with your owner account and look at the Health page: every part of the stack, checked live.',
        ]} />
        <P className="mt-4">See what Terraform knows about: the outputs, and every resource in the state.</P>
        <Code shell="bash" where="terraform/">{`
terraform output
terraform state list
`}</Code>
        <P>Send yourself a test alert to prove the email path works:</P>
        <Code shell="bash" where="terraform/">{`
aws lambda invoke --function-name "$(terraform output -raw monitor_function)" \\
  --cli-binary-format raw-in-base64-out --payload '{"action": "test"}' out.json
`}</Code>
        <Learn>
          <p>A deploy that finished is not the same as a system that works. The health check reads each resource’s real
            state (tables, bucket encryption, the SES sender, alarms) and makes requests from outside, so it catches
            things <C>terraform apply</C> can’t, like an unclicked verification link.</p>
        </Learn>
      </>
    ),
  },
];

/* ---- Troubleshooting ----------------------------------------------------- */

export function Troubleshooting() {
  return (
    <div className="panel overflow-hidden">
      <Trouble title={<>Apply fails at <C>null_resource.layers_build</C> with “/bin/bash” or “python3” not found</>}>
        <p>Terraform runs <C>build.sh</C> with <C>bash_bin</C> and <C>python_bin</C>, whose defaults are Linux paths. On Windows set:</p>
        <Code shell="file" title="terraform.tfvars">{`
bash_bin   = "C:/Program Files/Git/bin/bash.exe"
python_bin = "python"
`}</Code>
        <p>If <C>python</C> itself opens the Microsoft Store, turn off its App execution aliases (step 2).</p>
      </Trouble>
      <Trouble title={<>Scripts fail with <C>$'\r': command not found</C></>}>
        <p>Git converted the scripts to Windows line endings when you cloned, and bash can’t read them. Clone again with conversion off:</p>
        <Code shell="bash">{`git clone --config core.autocrlf=false ${REPO_URL}.git`}</Code>
      </Trouble>
      <Trouble title="“Unable to locate credentials”, “InvalidClientTokenId” or “ExpiredToken”">
        <p>Terraform or the CLI can’t find valid keys. Check <C>aws sts get-caller-identity</C> works in the same terminal.
          If you used a named profile, make sure <C>aws_profile</C> in <C>terraform.tfvars</C> has the same name.</p>
      </Trouble>
      <Trouble title="AWS commands in deploy.sh complain about the region or profile">
        <p>The script finds <C>aws_region</C> and <C>aws_profile</C> by matching lines that start with those names. Keep each
          setting on its own line, at the start of the line, with the value in double quotes.</p>
      </Trouble>
      <Trouble title="“Your account must be verified before you can add new CloudFront resources”">
        <p>New accounts can’t create CloudFront distributions until AWS Support verifies them. Use
          {' '}<C>web_hosting = "amplify"</C> (the default), or open a support case and switch later.</p>
      </Trouble>
      <Trouble title="BucketAlreadyExists when creating the files bucket">
        <p>S3 bucket names are shared by every AWS account. The default name ends with your account ID, so this only
          happens if you set <C>files_bucket_name</C>: pick a more unique name, or remove the line.</p>
      </Trouble>
      <Trouble title="Uploads fail in the browser with a CORS error">
        <p>The browser sends files straight to S3, and the bucket only accepts the hosted app plus
          {' '}<C>allowed_origins</C>. If you run the app from another address, add it there and run <C>bash deploy.sh</C> again.</p>
      </Trouble>
      <Trouble title="Share emails fail with “Email address is not verified”">
        <p>Click the SES verification link sent to <C>sender_email</C>. While your account is in the SES sandbox, every
          recipient has to be verified too; request production access in the SES console to lift that.</p>
      </Trouble>
      <Trouble title={<><C>admin-account.sh</C> says “No owner admin”</>}>
        <p>Add your address to <C>admin_emails</C> in lowercase, run <C>bash deploy.sh</C>, then run the script again.
          An address with capitals fails validation with “admin_emails must be lowercase email addresses without spaces.”</p>
      </Trouble>
      <Trouble title="The deploy stopped halfway">
        <p>Run <C>bash deploy.sh</C> again. Terraform records each resource in the state as soon as it’s created, so the
          next run only does what’s left. If <C>alert_email</C> is confirmed, you’ll also get a “deploy failed” email.</p>
      </Trouble>
      <Trouble title={<>The Amplify deployment says FAILED, or the site still shows the old version</>}>
        <p>Run <C>bash deploy.sh</C> again; it uploads a fresh zip. If the job succeeded, reload without the cache
          (Ctrl+Shift+R).</p>
      </Trouble>
      <Trouble title="A signed-out account can still call the API for a few minutes">
        <p>That’s the authorizer cache: API Gateway reuses a valid answer for <C>authorizer_cache_seconds</C> (300).
          Lower it for faster sign-outs at the cost of more authorizer calls.</p>
      </Trouble>
      <Trouble title={<><C>make: command not found</C></>}>
        <p>Git Bash doesn’t include <C>make</C>. Every target in the Makefile is a single Terraform command, and this
          guide shows those commands directly.</p>
      </Trouble>
    </div>
  );
}

/* ---- Costs --------------------------------------------------------------- */

export function Costs() {
  return (
    <>
      <P>
        At personal or demo scale DropVault runs for roughly <span className="font-medium text-fg">$0 to $1 a month</span>.
        Almost everything is billed per request or per gigabyte, so an idle deployment costs very little. Prices vary by
        region and change over time; treat every figure here as approximate and check the AWS pricing pages.
      </P>
      <Table head={['What', 'Billed for', 'Approximate cost']} rows={[
        ['Lambda, API Gateway, DynamoDB', 'Requests (on-demand)', 'About $0 at demo scale, within free tiers if your account has them'],
        ['S3 files bucket', 'Storage, plus data downloaded', 'About $0.025 per GB-month stored'],
        ['KMS', 'Keys per month', <><C>s3</C>: free · <C>shared</C>: about $1 a month · <C>per_user</C>: about $1 per user a month</>],
        ['CloudWatch alarms', '13 alarms: 11 for Lambdas (all but the authorizer), 2 for the API', 'First 10 free, then about $0.10 each: about $0.30 a month'],
        ['CloudWatch Logs', 'Log data stored (14 days)', 'Cents at demo scale'],
        ['DynamoDB point-in-time recovery', 'Backup storage', 'Cents a month'],
        ['Amplify Hosting', 'Storage and data served', 'Cents for a small site; no build minutes, since deploy.sh uploads a finished build'],
        ['Monitor, SNS, EventBridge', 'Runs every 5 minutes, alert emails', 'Within the free tiers'],
      ]} />
      <Warn title="What makes the bill grow">
        <p>Storing and downloading large files, many users with <C>per_user</C> keys, and leaving the stack running after
          you’re done. The budget alert from step 1 is your safety net.</p>
      </Warn>
    </>
  );
}

/* ---- Updating ------------------------------------------------------------ */

export function Updating() {
  return (
    <>
      <P>Changed the code or a setting? Run the same command again. It’s safe to repeat: Terraform only touches what changed, and the web app is rebuilt and republished every time.</P>
      <Code shell="bash" where="terraform/">bash deploy.sh</Code>
      <Bullets className="mt-3" items={[
        <>Edited a function in <C>endpoints/</C>: its zip hash changes, so only that Lambda is updated.</>,
        <>Edited shared code in <C>endpoints/common</C>: a new layer version is published and every function moves to it.</>,
        <>Changed a route in a <C>.tf</C> file: the API deployment’s trigger hash changes and the stage is redeployed.</>,
        <>Changed only <C>web/</C>: Terraform has nothing to do, and the new build is published.</>,
      ]} />
      <h3 className="mt-8 text-[17px] font-semibold tracking-tight">See the change before you make it</h3>
      <Code shell="bash" where="terraform/">terraform plan -var-file=terraform.tfvars</Code>
      <Warn>
        <p>Changing <C>app_name</C> or <C>environment</C> renames every resource, and Terraform renames by replacing:
          the old bucket and tables are deleted with everything in them. Read the plan for <C>-/+</C> and <C>destroy</C> lines first.</p>
      </Warn>
      <h3 className="mt-8 text-[17px] font-semibold tracking-tight">Run the checks CI runs</h3>
      <P>The tests run the real handlers against a mocked AWS, so they need no account. GitHub Actions runs these on every push, plus <C>terraform fmt -check</C>, <C>terraform validate</C> and the web build.</P>
      <Code shell="bash" where="the repository root">{`
python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements-dev.txt
ruff check .
pytest
`}</Code>
      <h3 className="mt-8 text-[17px] font-semibold tracking-tight">Work on the web app against your deployed API</h3>
      <P>Put your API URL (<C>terraform output -raw api_url</C>) in <C>web/.env.local</C>, which Git ignores:</P>
      <Code shell="file" title=".env.local" where="web/">{`
VITE_AUTH_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev
VITE_FILE_URL=https://<api-id>.execute-api.<region>.amazonaws.com/dev
`}</Code>
      <Code shell="bash" where="web/">{`
npm install
npm run dev
`}</Code>
      <P>The app opens on <C>http://localhost:3001</C>, which is already in <C>allowed_origins</C>, so uploads to S3 work from there too.</P>
      <Note title="Renaming the Amplify address">
        <p>The address starts with <C>amplify_branch</C> (<C>main</C> by default). To change it and keep old links working,
          set <C>amplify_branch</C> to the new name and list the old one in <C>amplify_redirect_branches</C>; <C>deploy.sh</C> publishes a
          small redirect page there.</p>
      </Note>
    </>
  );
}

/* ---- Teardown ------------------------------------------------------------ */

export function Teardown() {
  return (
    <>
      <P>One command removes everything Terraform created. It shows the plan and waits for you to type <C>yes</C>.</P>
      <Code shell="bash" where="terraform/">terraform destroy -var-file=terraform.tfvars</Code>
      <Warn title="This deletes your data">
        <p>The files bucket has <C>force_destroy = true</C>, so every uploaded file goes with it, along with all accounts,
          links and the Amplify app. Download anything you want to keep first.</p>
      </Warn>
      <h3 className="mt-8 text-[17px] font-semibold tracking-tight">KMS keys</h3>
      <P>
        With <C>kms_mode = "per_user"</C> the app created keys Terraform never knew about. Destroy runs
        {' '}<C>cleanup_kms.sh</C> for you (from <C>null_resource.kms_cleanup</C> in <C>kms.tf</C>): it deletes the
        {' '}<C>{'alias/<app_name>-<environment>/user/…'}</C> aliases and schedules deletion of every key tagged with your
        prefix. AWS waits 7 days before a key is gone; the shared key also has a 7-day window.
      </P>
      <P className="mt-3">If that step couldn’t run (for example, a wrong <C>bash_bin</C>), run the script yourself with your own prefix and region:</P>
      <Code shell="bash" where="terraform/">PREFIX=enclave-dev REGION=ap-south-1 bash cleanup_kms.sh</Code>
      <P><C>PREFIX</C> is <C>{'<app_name>-<environment>'}</C>. With <C>make</C> installed, <C>make clean-kms</C> reads both from your settings.</P>
      <Warn>
        <p>Only run the KMS cleanup when you’re removing the deployment. Files encrypted with those keys can’t be read once the keys are gone.</p>
      </Warn>
      <h3 className="mt-8 text-[17px] font-semibold tracking-tight">Make sure nothing is left</h3>
      <Bullets className="mt-3" items={[
        'Check Billing and Cost Management the next day. Charges stop once resources are deleted; a few cents can still appear for the partial month.',
        'In the KMS console, any customer keys should say “Pending deletion”.',
        'Deactivate or delete your IAM user’s access key if you’re done with the CLI.',
        <>Locally, <C>build/</C> and <C>.terraform/</C> can go (that’s what <C>make clean</C> removes). The state file is now empty.</>,
      ]} />
      <Learn>
        <p>Because the whole stack lives in the state file, you can create and destroy it as often as you like: a fresh
          {' '}<C>bash deploy.sh</C> rebuilds it in minutes. That repeatability, not the one command, is the real point of
          infrastructure as code.</p>
      </Learn>
    </>
  );
}

/* ---- Before you start ---------------------------------------------------- */

export function BeforeYouStart() {
  return (
    <>
      <Bullets items={[
        'An AWS account you can sign in to as root, with a payment card on it.',
        'A Windows 10 or 11 PC where you can install software.',
        'An email address you can read: AWS sends verification and alert links to it.',
        'About an hour the first time. The deploy itself is a few minutes; most of the time is setup and reading.',
      ]} />
      <Note title="No AWS account yet?">
        <p>You can run the whole app offline with LocalStack and Docker instead:{' '}
          <C>powershell -ExecutionPolicy Bypass -File local\start.ps1</C>. See <FileLink path="local/README.md" />.</p>
      </Note>
      <P className="mt-4">
        The steps assume you’ve skimmed <Link to="/how-it-works" className="link">How it works</Link>, which shows what
        each part does with a request. This page covers creating those parts.
      </P>
    </>
  );
}
