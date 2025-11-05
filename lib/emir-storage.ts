import { RemovalPolicy, Duration } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess, EventType, LifecycleRule } from 'aws-cdk-lib/aws-s3';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { CfnWorkGroup } from 'aws-cdk-lib/aws-athena';
import { Construct } from 'constructs';
import { EmirConfig, EmirNaming } from './emir-config';

export interface EmirStorageProps {
  config: EmirConfig;
  naming: EmirNaming;
}

/**
 * EMIR Storage Construct
 * Creates S3 buckets and Athena workgroup for EMIR reporting
 */
export class EmirStorage extends Construct {
  public readonly rawDataBucket: Bucket;
  public readonly reportsBucket: Bucket;
  public readonly athenaResultsBucket: Bucket;
  public readonly athenaWorkgroup: CfnWorkGroup;

  constructor(scope: Construct, id: string, props: EmirStorageProps) {
    super(scope, id);

    const { config, naming } = props;

    // 1. Raw Data Bucket - Stores incoming EMIR CSV files
    this.rawDataBucket = new Bucket(this, 'RawDataBucket', {
      bucketName: naming.bucket('raw-data'),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true, // Keep versions for audit trail
      lifecycleRules: this.getRawDataLifecycleRules(config),
      removalPolicy: config.environment === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: config.environment === 'dev', // Only auto-delete in dev
    });

    // 2. Reports Bucket - Stores generated PDF/Excel reports
    this.reportsBucket = new Bucket(this, 'ReportsBucket', {
      bucketName: naming.bucket('reports'),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: this.getReportsLifecycleRules(config),
      removalPolicy: config.environment === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN,
      autoDeleteObjects: config.environment === 'dev',
      cors: [
        {
          allowedMethods: ['GET'],
          allowedOrigins: ['*'], // Restrict in production
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // 3. Athena Results Bucket - Stores Athena query results
    this.athenaResultsBucket = new Bucket(this, 'AthenaResultsBucket', {
      bucketName: naming.bucket('athena-results'),
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      lifecycleRules: [
        {
          id: 'DeleteOldQueryResults',
          enabled: true,
          expiration: Duration.days(30), // Auto-cleanup query results
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY, // Always destroy - temp data
      autoDeleteObjects: true,
    });

    // 4. Athena Workgroup - For running EMIR validation queries
    this.athenaWorkgroup = new CfnWorkGroup(this, 'AthenaWorkgroup', {
      name: naming.athenaWorkgroup(),
      description: `Athena workgroup for EMIR accuracy reporting - ${config.environment}`,
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${this.athenaResultsBucket.bucketName}/queries/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: config.enableMonitoring,
        bytesScannedCutoffPerQuery: config.athenaDataScanLimitGB * 1024 * 1024 * 1024, // Convert GB to bytes
        requesterPaysEnabled: false,
        engineVersion: {
          selectedEngineVersion: 'Athena engine version 3',
        },
      },
    });
  }

  /**
   * Configure lifecycle rules for raw data bucket
   */
  private getRawDataLifecycleRules(config: EmirConfig): LifecycleRule[] {
    const rules: LifecycleRule[] = [];

    if (config.environment === 'prod') {
      // Production: Archive to Glacier after 90 days, delete after 2 years
      rules.push({
        id: 'ArchiveOldData',
        enabled: true,
        transitions: [
          {
            storageClass: 'GLACIER',
            transitionAfter: Duration.days(90),
          },
        ],
        expiration: Duration.days(730), // 2 years regulatory requirement
      });

      // Move failed files to separate prefix
      rules.push({
        id: 'CleanupFailedFiles',
        enabled: true,
        prefix: 'failed/',
        expiration: Duration.days(90),
      });
    } else {
      // Dev/Staging: Keep for shorter period
      rules.push({
        id: 'DeleteOldDevData',
        enabled: true,
        expiration: Duration.days(90),
      });
    }

    return rules;
  }

  /**
   * Configure lifecycle rules for reports bucket
   */
  private getReportsLifecycleRules(config: EmirConfig): LifecycleRule[] {
    return [
      {
        id: 'ManageReportRetention',
        enabled: true,
        expiration: Duration.days(config.reportRetentionDays),
      },
    ];
  }

  /**
   * Add S3 event notification to trigger Lambda on CSV upload
   */
  public addDataLoaderTrigger(dataLoaderFunction: LambdaFunction): void {
    this.rawDataBucket.addEventNotification(
      EventType.OBJECT_CREATED,
      new LambdaDestination(dataLoaderFunction),
      {
        suffix: '.csv', // Only trigger on CSV files
      }
    );
  }

  /**
   * Grant read access to raw data bucket
   */
  public grantRawDataRead(grantee: any): void {
    this.rawDataBucket.grantRead(grantee);
  }

  /**
   * Grant write access to reports bucket
   */
  public grantReportsWrite(grantee: any): void {
    this.reportsBucket.grantWrite(grantee);
  }

  /**
   * Grant read/write access to Athena results bucket
   */
  public grantAthenaAccess(grantee: any): void {
    this.athenaResultsBucket.grantReadWrite(grantee);
  }
}

