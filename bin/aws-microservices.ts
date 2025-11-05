#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsMicroservicesStack } from '../lib/aws-microservices-stack';
import { EmirReportingStack } from '../lib/emir-stack';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environment = app.node.tryGetContext('env') || 'dev';
const account = process.env.CDK_DEFAULT_ACCOUNT || '194561596031';

// Stack 1: E-commerce Microservices (Reference/Learning - deployed to us-east-1)
new AwsMicroservicesStack(app, 'AwsMicroservicesStack', {
  env: {
    account: account,
    region: 'us-east-1', // Original e-commerce stack stays in us-east-1
  },
  description: 'E-commerce microservices stack (reference architecture)',
});

// Stack 2: EMIR Reporting (Production - deployed to eu-central-1)
new EmirReportingStack(app, `EmirReportingStack-${environment.charAt(0).toUpperCase() + environment.slice(1)}`, {
  environment: environment as any,
  env: {
    account: account,
    region: 'eu-central-1', // EMIR stack in Frankfurt for data privacy & compliance
  },
  description: `EMIR accuracy reporting infrastructure - ${environment} environment`,
  tags: {
    Project: 'EMIR-Reporting',
    Environment: environment,
  },
});