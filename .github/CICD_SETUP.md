# CI/CD Pipeline Setup Guide

## Overview
This repository uses **GitHub Actions** for automated CI/CD pipeline to deploy AWS CDK infrastructure.

## Pipeline Workflows

### 1. **PR Check** (`.github/workflows/pr-check.yml`)
Runs on every Pull Request to `main` or `develop`:
- ✅ Install dependencies
- ✅ Build TypeScript
- ✅ Run tests
- ✅ CDK Synth (validate templates)
- ✅ Security audit

### 2. **CDK Deploy** (`.github/workflows/cdk-deploy.yml`)
Main deployment pipeline with multiple jobs:

#### Jobs:
- **Validate & Test**: Runs tests and builds code
- **CDK Diff**: Shows infrastructure changes on PRs
- **Deploy to Dev**: Auto-deploys when pushing to `develop` branch
- **Deploy to Production**: Auto-deploys when pushing to `main` branch
- **Manual Deploy**: Allows manual triggering via GitHub UI

## Setup Instructions

### Step 1: Configure AWS Credentials in GitHub Secrets

You need to add the following secrets to your GitHub repository:

**For Development/Sandbox:**
1. Go to: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`
2. Add these secrets:
   - `AWS_ACCESS_KEY_ID` - Your AWS Access Key
   - `AWS_SECRET_ACCESS_KEY` - Your AWS Secret Key
   - `AWS_ACCOUNT_ID` - Your AWS Account ID (e.g., `194561596031`)

**For Production (optional, separate account):**
   - `AWS_ACCESS_KEY_ID_PROD`
   - `AWS_SECRET_ACCESS_KEY_PROD`
   - `AWS_ACCOUNT_ID_PROD`

### Step 2: Get Your AWS Credentials

If you don't have programmatic access keys yet:

```bash
# Check your current identity
aws sts get-caller-identity

# Create new access keys (if needed)
# Go to AWS Console → IAM → Users → Your User → Security Credentials → Create Access Key
```

Or use **IAM Role with OIDC** (more secure, recommended for production):
- See: https://github.com/aws-actions/configure-aws-credentials#assuming-a-role

### Step 3: Update Configuration

Edit `.github/workflows/cdk-deploy.yml`:

1. **Change AWS Region** (line 12):
   ```yaml
   AWS_REGION: us-east-1  # Change to your region (e.g., eu-west-1)
   ```

2. **Update Environment URLs** (lines 82, 112):
   ```yaml
   url: https://your-app-url.com
   ```

### Step 4: GitHub Environments (Optional but Recommended)

Create GitHub Environments for approval gates:

1. Go to: `Settings` → `Environments`
2. Create two environments:
   - **development** - No approval required
   - **production** - Add required reviewers (yourself or team)

This adds a manual approval step before production deployments.

### Step 5: Bootstrap CDK (First Time Only)

The pipeline will attempt to bootstrap automatically, but you can do it manually:

```bash
# Bootstrap for your account/region
npx cdk bootstrap aws://194561596031/us-east-1

# Or let GitHub Actions do it (it's included in the workflow)
```

## How to Use

### Automatic Deployments

1. **Deploy to Dev**:
   ```bash
   git checkout develop
   git add .
   git commit -m "Your changes"
   git push origin develop
   ```
   → Automatically deploys to development environment

2. **Deploy to Production**:
   ```bash
   git checkout main
   git merge develop
   git push origin main
   ```
   → Automatically deploys to production (after approval if configured)

### Manual Deployment

1. Go to: `Actions` → `CDK Deploy` → `Run workflow`
2. Select branch
3. Click "Run workflow"

### View Infrastructure Changes (before merging)

1. Create a Pull Request to `main` or `develop`
2. The pipeline will run `cdk diff` and show what will change
3. Review changes before merging

## Workflow Triggers

| Workflow | Trigger | Action |
|----------|---------|--------|
| PR Check | Pull Request to `main`/`develop` | Validate code, run tests |
| CDK Diff | Pull Request to `main`/`develop` | Show infrastructure changes |
| Deploy Dev | Push to `develop` | Auto-deploy to dev |
| Deploy Prod | Push to `main` | Auto-deploy to production |
| Manual Deploy | Manual trigger | Deploy to configured environment |

## Troubleshooting

### Pipeline Fails: "AWS credentials not found"
- Check GitHub Secrets are correctly configured
- Verify secret names match exactly: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`

### Pipeline Fails: "CDK bootstrap required"
- The workflow will auto-bootstrap, but if it fails:
- Run bootstrap manually or check IAM permissions

### Pipeline Fails: "Insufficient permissions"
- Your AWS user needs these permissions:
  - CloudFormation (full)
  - S3 (full for CDK bucket)
  - Lambda, API Gateway, DynamoDB, etc. (based on your stack)
  - Recommended: `AdministratorAccess` for CDK deployments (dev/sandbox)

### Pipeline Hangs on Manual Approval
- If you configured production environment with required reviewers
- Go to: `Actions` → Click the running workflow → Review deployment → Approve

## Security Best Practices

1. **Use separate AWS accounts** for dev and production
2. **Enable GitHub Environment protection rules** for production
3. **Use OIDC instead of access keys** (more secure):
   - See: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
4. **Rotate access keys regularly**
5. **Use least-privilege IAM policies**

## Local Development

To test locally without deploying:

```bash
# Synthesize CloudFormation (see what will be created)
npm run build
npx cdk synth

# Show differences from deployed stack
npx cdk diff

# Deploy manually (if needed)
npx cdk deploy --all
```

**Note**: Local CDK commands may have issues in WSL environments. Use GitHub Actions for deployments if you encounter path issues.

## Cost Monitoring

- Monitor AWS costs in CloudWatch or AWS Cost Explorer
- Estimated cost for EMIR reporting infrastructure: $50-200/month
- Estimated cost for existing e-commerce stack: Varies by usage

## Pipeline Badges

Add to your README.md:

```markdown
[![CDK Deploy](https://github.com/YOUR_USERNAME/G20Reporting/actions/workflows/cdk-deploy.yml/badge.svg)](https://github.com/YOUR_USERNAME/G20Reporting/actions/workflows/cdk-deploy.yml)
[![PR Check](https://github.com/YOUR_USERNAME/G20Reporting/actions/workflows/pr-check.yml/badge.svg)](https://github.com/YOUR_USERNAME/G20Reporting/actions/workflows/pr-check.yml)
```

## Next Steps

1. ✅ Configure GitHub Secrets (AWS credentials)
2. ✅ Create `develop` branch: `git checkout -b develop && git push origin develop`
3. ✅ Test the pipeline: Push a small change to `develop`
4. ✅ Review deployment in AWS Console
5. ✅ Configure production environment with approvals
6. 🚀 Start building EMIR infrastructure!

---

*Last updated: 2025-11-05*

