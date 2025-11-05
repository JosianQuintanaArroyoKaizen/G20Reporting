# G20 Reporting - AWS Serverless Infrastructure

[![CDK Version](https://img.shields.io/badge/AWS%20CDK-2.222.0-orange)](https://aws.amazon.com/cdk/)
[![Node Version](https://img.shields.io/badge/Node-20.x-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.4-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This repository contains AWS CDK infrastructure for:
1. **EMIR Accuracy Reporting System** - G20 regulatory compliance reporting (in development)
2. **E-commerce Microservices** - Serverless event-driven architecture (learning/reference)

## 🚀 Quick Start

### Prerequisites
- **AWS Account** with appropriate permissions
- **Node.js 20.x or 22.x** (current: using Node 20 LTS)
- **AWS CLI** configured with credentials
- **Git** for version control

### Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd G20Reporting

# Install dependencies
npm install

# Configure AWS credentials (if not already done)
aws configure

# Bootstrap CDK (first time only)
./deploy.sh bootstrap

# Synthesize CloudFormation templates
./deploy.sh synth

# Deploy all stacks
./deploy.sh deploy
```

## 📦 Projects

### 1. EMIR Accuracy Reporting System (Primary Project)

**Status**: 🚧 In Development

Comprehensive data quality and accuracy reporting for ETD ESMA EOD Trade Activity data, analyzing EMIR regulatory reporting compliance.

**Architecture**:
- **S3** - Raw CSV storage (partitioned by date)
- **Athena** - SQL analytics on S3 data
- **Step Functions** - 8-phase validation pipeline
- **Lambda** - Validation logic and report generation
- **DynamoDB** - Metadata and validation results
- **Glue Data Catalog** - Schema management for 203 EMIR fields

**Documentation**: See [`emir-accuracy-report-guide.md`](emir-accuracy-report-guide.md)

### 2. E-commerce Microservices (Reference Architecture)

**Based on**: [AWS Serverless Microservices Udemy Course](https://www.udemy.com/course/aws-serverless-microservices-lambda-eventbridge-sqs-apigateway/)

![course2](https://user-images.githubusercontent.com/1147445/158019166-96732203-6642-4242-b1d9-d53ece2e1ed3.png)

This is a Serverless Event-driven E-commerce project for TypeScript development with CDK.
The `cdk.json` file tells the CDK Toolkit how to execute your app.

### Check Explanation of this Repository on Medium
* [AWS Event-driven Serverless Microservices using AWS Lambda, API Gateway, EventBridge, SQS, DynamoDB and CDK for IaC](https://mehmetozkaya.medium.com/aws-event-driven-serverless-microservices-using-aws-lambda-api-gateway-eventbridge-sqs-dynamodb-a7f46220b738)
* [See All Articles - AWS Serverless Microservices with Patterns & Best Practices](https://medium.com/aws-serverless-microservices-with-patterns-best)

## Whats Including In This Repository
We will be following the reference architecture above which is a real-world **Serverless E-commerce application** and it includes;

* **REST API** and **CRUD** endpoints with using **AWS Lambda, API Gateway**
* **Data persistence** with using **AWS DynamoDB**
* **Decouple microservices** with events using **Amazon EventBridge**
* **Message Queues** for cross-service communication using **AWS SQS**
* **Cloud stack development** with **IaC** using **AWS CloudFormation and AWS CDK**

## Prerequisites
You will need the following tools:

* AWS Account and User
* AWS CLI
* NodeJS
* AWS CDK Toolkit
* Docker

### Run The Project
Follow these steps to get your development environment set up: (Before Run Start the Docker Desktop)
1. Clone the repository
2. At the root directory which include **cdk.json** files, run below command:
```csharp
cdk deploy
```
>Note: Make sure that your Docker Desktop is running before execute the cdk deploy command.

4. Wait for provision all microservices into aws cloud. That’s it!

5. You can **launch microservices** as below urls:

* **Product API -> https://xxx.execute-api.ap-southeast-1.amazonaws.com/prod/product**
* **Basket API -> https://xxx.execute-api.ap-southeast-1.amazonaws.com/prod/basket**
* **Ordering API -> https://xxx.execute-api.ap-southeast-1.amazonaws.com/prod/order**

## 🔄 CI/CD Pipeline

This project uses **GitHub Actions** for automated deployment:

- ✅ **PR Checks** - Validate code on every Pull Request
- ✅ **Automatic Deployment** - Deploy to dev/prod on branch push
- ✅ **CDK Diff** - Show infrastructure changes in PRs
- ✅ **Manual Deployment** - Trigger deployments via GitHub UI

### Setup CI/CD

See detailed setup guide: [`.github/CICD_SETUP.md`](.github/CICD_SETUP.md)

**Quick Setup:**
1. Add GitHub Secrets (AWS credentials):
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_ACCOUNT_ID`
2. Create `develop` branch: `git checkout -b develop && git push origin develop`
3. Push changes to trigger pipeline

### Branch Strategy
- `main` → Production deployment (requires approval)
- `develop` → Development deployment (automatic)
- Feature branches → Create PR to `develop`

## 🛠️ Useful Commands

### Using Helper Script (Recommended for WSL)
```bash
./deploy.sh synth          # Synthesize CDK stacks
./deploy.sh diff           # Show differences from deployed stack
./deploy.sh deploy         # Deploy all stacks
./deploy.sh deploy <stack> # Deploy specific stack
./deploy.sh bootstrap      # Bootstrap CDK for your account
./deploy.sh list           # List all stacks
./deploy.sh test           # Run tests
./deploy.sh help           # Show all commands
```

### Using NPM/CDK Directly
```bash
npm run build              # Compile typescript to js
npm run watch              # Watch for changes and compile
npm run test               # Perform the jest unit tests
npx cdk deploy             # Deploy this stack to your AWS account/region
npx cdk diff               # Compare deployed stack with current state
npx cdk synth              # Emits the synthesized CloudFormation template
```

**Note**: Local CDK commands may have WSL path issues. Use `./deploy.sh` or GitHub Actions instead.

## 📋 Project Status

### Completed ✅
- [x] CDK infrastructure setup (v2.222.0)
- [x] TypeScript 5.5.4 configuration
- [x] CI/CD pipeline (GitHub Actions)
- [x] E-commerce microservices stack
- [x] Helper scripts for deployment
- [x] Zero security vulnerabilities

### In Progress 🚧
- [ ] EMIR Storage construct (`lib/storage.ts`)
- [ ] EMIR Glue Data Catalog (`lib/glue-catalog.ts`)
- [ ] EMIR DynamoDB tables
- [ ] EMIR Lambda functions (6 microservices)
- [ ] EMIR Step Functions pipeline
- [ ] EMIR Report generation

### Planned 📅
- [ ] API Gateway for report retrieval
- [ ] CloudWatch dashboards
- [ ] Cost monitoring alerts
- [ ] Production deployment
- [ ] Historical trend analysis

## Authors

* **Mehmet Ozkaya** - *Initial work* - [mehmetozkaya](https://github.com/mehmetozkaya)

See also the list of [contributors](https://github.com/aspnetrun/run-core/contributors) who participated in this project. Check also [gihtub page of repository.](https://aspnetrun.github.io/run-aspnetcore-angular-realworld/)
