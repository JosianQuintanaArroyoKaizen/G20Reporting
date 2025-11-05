import { Stack } from 'aws-cdk-lib';

/**
 * EMIR Infrastructure Configuration
 * Handles dynamic naming based on environment and region
 */

export type Environment = 'dev' | 'staging' | 'prod';

export interface EmirConfig {
  environment: Environment;
  region: string;
  account: string;
  
  // Feature flags
  enableMonitoring: boolean;
  enableAlarms: boolean;
  enableDetailedLogging: boolean;
  
  // Retention policies
  logRetentionDays: number;
  reportRetentionDays: number;
  
  // Capacity settings
  lambdaMemorySizes: {
    dataLoader: number;
    completenessValidator: number;
    formatValidator: number;
    logicalValidator: number;
    scoringEngine: number;
    reportGenerator: number;
  };
  
  // Cost controls
  athenaDataScanLimitGB: number;
}

/**
 * Environment-specific configurations
 */
const ENVIRONMENT_CONFIGS: Record<Environment, Partial<EmirConfig>> = {
  dev: {
    enableMonitoring: false,
    enableAlarms: false,
    enableDetailedLogging: true,
    logRetentionDays: 30,
    reportRetentionDays: 90,
    lambdaMemorySizes: {
      dataLoader: 512,
      completenessValidator: 1024,
      formatValidator: 1024,
      logicalValidator: 1536,
      scoringEngine: 512,
      reportGenerator: 3008
    },
    athenaDataScanLimitGB: 100
  },
  
  staging: {
    enableMonitoring: true,
    enableAlarms: false,
    enableDetailedLogging: true,
    logRetentionDays: 60,
    reportRetentionDays: 365,
    lambdaMemorySizes: {
      dataLoader: 512,
      completenessValidator: 1536,
      formatValidator: 1536,
      logicalValidator: 2048,
      scoringEngine: 1024,
      reportGenerator: 3008
    },
    athenaDataScanLimitGB: 200
  },
  
  prod: {
    enableMonitoring: true,
    enableAlarms: true,
    enableDetailedLogging: false,
    logRetentionDays: 90,
    reportRetentionDays: 730, // 2 years regulatory requirement
    lambdaMemorySizes: {
      dataLoader: 1024,
      completenessValidator: 2048,
      formatValidator: 2048,
      logicalValidator: 3008,
      scoringEngine: 1024,
      reportGenerator: 3008
    },
    athenaDataScanLimitGB: 500
  }
};

/**
 * Resource naming utilities
 */
export class EmirNaming {
  private config: EmirConfig;
  private regionCode: string;
  
  constructor(config: EmirConfig) {
    this.config = config;
    this.regionCode = this.getRegionCode(config.region);
  }
  
  /**
   * Convert region to short code for naming
   * us-east-1 -> use1
   * eu-west-1 -> euw1
   */
  private getRegionCode(region: string): string {
    const parts = region.split('-');
    if (parts.length !== 3) return region;
    
    const regionMap: Record<string, string> = {
      'us': 'us',
      'eu': 'eu',
      'ap': 'ap',
      'ca': 'ca',
      'sa': 'sa'
    };
    
    const directionMap: Record<string, string> = {
      'east': 'e',
      'west': 'w',
      'central': 'c',
      'north': 'n',
      'south': 's',
      'northeast': 'ne',
      'southeast': 'se'
    };
    
    const prefix = regionMap[parts[0]] || parts[0];
    const direction = directionMap[parts[1]] || parts[1].charAt(0);
    const number = parts[2];
    
    return `${prefix}${direction}${number}`;
  }
  
  /**
   * Get environment suffix for resource names
   */
  private getEnvSuffix(): string {
    return this.config.environment.charAt(0).toUpperCase() + 
           this.config.environment.slice(1);
  }
  
  /**
   * S3 bucket naming (must be globally unique, lowercase, no underscores)
   * Pattern: emir-{purpose}-{env}-{region}-{account}
   */
  bucket(purpose: string): string {
    return `emir-${purpose}-${this.config.environment}-${this.config.region}-${this.config.account}`;
  }
  
  /**
   * DynamoDB table naming
   * Pattern: Emir{Purpose}-{Environment}-{RegionCode}
   */
  table(purpose: string): string {
    return `Emir${purpose}-${this.getEnvSuffix()}-${this.regionCode.toUpperCase()}`;
  }
  
  /**
   * Lambda function naming
   * Pattern: emir-{purpose}-{env}-{region}
   */
  lambda(purpose: string): string {
    return `emir-${purpose}-${this.config.environment}-${this.config.region}`;
  }
  
  /**
   * Step Functions state machine naming
   * Pattern: Emir{Purpose}-{Environment}-{RegionCode}
   */
  stateMachine(purpose: string): string {
    return `Emir${purpose}-${this.getEnvSuffix()}-${this.regionCode.toUpperCase()}`;
  }
  
  /**
   * Glue database naming (lowercase, underscores allowed)
   * Pattern: emir_reporting_{env}_{regioncode}
   */
  glueDatabase(): string {
    return `emir_reporting_${this.config.environment}_${this.regionCode.toLowerCase()}`;
  }
  
  /**
   * Glue table naming (lowercase)
   */
  glueTable(tableName: string): string {
    return tableName.toLowerCase();
  }
  
  /**
   * Athena workgroup naming
   * Pattern: emir-analytics-{env}
   */
  athenaWorkgroup(): string {
    return `emir-analytics-${this.config.environment}`;
  }
  
  /**
   * EventBridge event bus naming
   * Pattern: emir-event-bus-{env}
   */
  eventBus(): string {
    return `emir-event-bus-${this.config.environment}`;
  }
  
  /**
   * SNS topic naming
   * Pattern: emir-{purpose}-{env}
   */
  snsTopic(purpose: string): string {
    return `emir-${purpose}-${this.config.environment}`;
  }
  
  /**
   * CloudWatch log group naming
   * Pattern: /aws/{service}/emir-{purpose}-{env}-{region}
   */
  logGroup(service: string, purpose: string): string {
    return `/aws/${service}/emir-${purpose}-${this.config.environment}-${this.config.region}`;
  }
  
  /**
   * IAM role naming
   * Pattern: Emir{Purpose}Role-{Environment}
   */
  iamRole(purpose: string): string {
    return `Emir${purpose}Role-${this.getEnvSuffix()}`;
  }
  
  /**
   * API Gateway naming
   * Pattern: emir-reporting-api-{env}
   */
  apiGateway(): string {
    return `emir-reporting-api-${this.config.environment}`;
  }
  
  /**
   * CloudWatch dashboard naming
   * Pattern: EMIR-Reporting-{Environment}
   */
  dashboard(): string {
    return `EMIR-Reporting-${this.getEnvSuffix()}`;
  }
}

/**
 * Get configuration for environment
 */
export function getEmirConfig(
  stack: Stack,
  environment: Environment
): EmirConfig {
  const baseConfig: EmirConfig = {
    environment,
    region: stack.region,
    account: stack.account,
    ...ENVIRONMENT_CONFIGS[environment]
  } as EmirConfig;
  
  return baseConfig;
}

/**
 * Create naming helper
 */
export function createNaming(config: EmirConfig): EmirNaming {
  return new EmirNaming(config);
}

/**
 * Example usage:
 * 
 * const config = getEmirConfig(this, 'dev');
 * const naming = createNaming(config);
 * 
 * const bucketName = naming.bucket('raw-data');
 * // Output: emir-raw-data-dev-us-east-1-194561596031
 * 
 * const tableName = naming.table('ReportRuns');
 * // Output: EmirReportRuns-Dev-USE1
 * 
 * const lambdaName = naming.lambda('data-loader');
 * // Output: emir-data-loader-dev-us-east-1
 */

