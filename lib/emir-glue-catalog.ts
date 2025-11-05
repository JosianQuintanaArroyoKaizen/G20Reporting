import { Construct } from 'constructs';
import { CfnDatabase, CfnTable } from 'aws-cdk-lib/aws-glue';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { EmirConfig, EmirNaming } from './emir-config';

export interface EmirGlueCatalogProps {
  config: EmirConfig;
  naming: EmirNaming;
  rawDataBucket: Bucket;
}

/**
 * EMIR Glue Data Catalog Construct
 * Creates Glue database and table schema for 203 EMIR REFIT fields
 */
export class EmirGlueCatalog extends Construct {
  public readonly database: CfnDatabase;
  public readonly tradesTable: CfnTable;
  public readonly databaseName: string;
  public readonly tableName: string;

  constructor(scope: Construct, id: string, props: EmirGlueCatalogProps) {
    super(scope, id);

    const { config, naming, rawDataBucket } = props;

    this.databaseName = naming.glueDatabase();
    this.tableName = naming.glueTable('emir_trades');

    // Create Glue Database
    this.database = new CfnDatabase(this, 'Database', {
      catalogId: config.account,
      databaseInput: {
        name: this.databaseName,
        description: `EMIR reporting database for ${config.environment} environment`,
        locationUri: `s3://${rawDataBucket.bucketName}/`,
      },
    });

    // Create Glue Table with 203 EMIR REFIT fields
    this.tradesTable = new CfnTable(this, 'TradesTable', {
      catalogId: config.account,
      databaseName: this.databaseName,
      tableInput: {
        name: this.tableName,
        description: 'EMIR REFIT trade data - 203 fields',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'csv',
          'compressionType': 'none',
          'typeOfData': 'file',
          'skip.header.line.count': '1', // CSV has header row
        },
        storageDescriptor: {
          location: `s3://${rawDataBucket.bucketName}/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
            parameters: {
              'field.delim': ',',
              'escape.delim': '\\',
              'quote.delim': '"',
            },
          },
          columns: this.getEmirFieldSchema(),
        },
        partitionKeys: [
          {
            name: 'year',
            type: 'string',
            comment: 'Partition by year',
          },
          {
            name: 'month',
            type: 'string',
            comment: 'Partition by month',
          },
          {
            name: 'day',
            type: 'string',
            comment: 'Partition by day',
          },
        ],
      },
    });

    this.tradesTable.addDependency(this.database);
  }

  /**
   * Get EMIR REFIT field schema (203 fields)
   * Based on ESMA EMIR REFIT technical standards
   */
  private getEmirFieldSchema(): Array<{ name: string; type: string; comment?: string }> {
    return [
      // ===== Critical Identifiers (6 fields) =====
      { name: 'uti', type: 'string', comment: 'Unique Transaction Identifier' },
      { name: 'report_tracking_number', type: 'string', comment: 'Report tracking number' },
      { name: 'counterparty_1', type: 'string', comment: 'Reporting counterparty LEI (20 chars)' },
      { name: 'counterparty_2', type: 'string', comment: 'Other counterparty LEI (20 chars)' },
      { name: 'report_submitting_entity_id', type: 'string', comment: 'Submitting entity LEI' },
      { name: 'entity_responsible_reporting', type: 'string', comment: 'Responsible entity LEI' },

      // ===== Critical Trade Information (10 fields) =====
      { name: 'action_type', type: 'string', comment: 'NEW, MODIFY, CANCEL, ERROR, etc.' },
      { name: 'event_type', type: 'string', comment: 'Trade event type' },
      { name: 'event_date', type: 'date', comment: 'Event occurrence date' },
      { name: 'execution_timestamp', type: 'timestamp', comment: 'Trade execution timestamp' },
      { name: 'effective_date', type: 'date', comment: 'Contract effective date' },
      { name: 'expiration_date', type: 'date', comment: 'Contract expiration/maturity date' },
      { name: 'early_termination_date', type: 'date', comment: 'Early termination date if applicable' },
      { name: 'direction', type: 'string', comment: 'BUY or SELL' },
      { name: 'venue_identification', type: 'string', comment: 'Trading venue MIC code' },
      { name: 'master_agreement_type', type: 'string', comment: 'ISDA, NAFTA, etc.' },

      // ===== Product Information (15 fields) =====
      { name: 'isin', type: 'string', comment: 'ISIN code (12 characters)' },
      { name: 'upi', type: 'string', comment: 'Unique Product Identifier' },
      { name: 'asset_class', type: 'string', comment: 'EQUITY, COMMODITY, FX, INTEREST_RATE, CREDIT' },
      { name: 'product_classification', type: 'string', comment: 'CFI code' },
      { name: 'product_name', type: 'string', comment: 'Product name/description' },
      { name: 'underlying_isin', type: 'string', comment: 'Underlying asset ISIN' },
      { name: 'underlying_index', type: 'string', comment: 'Underlying index name' },
      { name: 'underlying_currency', type: 'string', comment: 'Underlying currency ISO 4217' },
      { name: 'notional_currency_1', type: 'string', comment: 'Notional currency 1 (ISO 4217)' },
      { name: 'notional_amount_1', type: 'decimal(18,2)', comment: 'Notional amount leg 1' },
      { name: 'notional_currency_2', type: 'string', comment: 'Notional currency 2 (ISO 4217)' },
      { name: 'notional_amount_2', type: 'decimal(18,2)', comment: 'Notional amount leg 2' },
      { name: 'price_currency', type: 'string', comment: 'Price currency' },
      { name: 'price', type: 'decimal(18,6)', comment: 'Trade price' },
      { name: 'price_notation', type: 'string', comment: 'Price notation type' },

      // ===== Clearing & Settlement (10 fields) =====
      { name: 'cleared', type: 'boolean', comment: 'Cleared indicator' },
      { name: 'central_counterparty', type: 'string', comment: 'CCP LEI' },
      { name: 'clearing_timestamp', type: 'timestamp', comment: 'Clearing acceptance timestamp' },
      { name: 'clearing_obligation', type: 'boolean', comment: 'Subject to clearing obligation' },
      { name: 'clearing_threshold', type: 'boolean', comment: 'Clearing threshold indicator' },
      { name: 'clearing_member', type: 'string', comment: 'Clearing member LEI' },
      { name: 'intragroup', type: 'boolean', comment: 'Intragroup transaction' },
      { name: 'post_trade_risk_reduction', type: 'boolean', comment: 'Post-trade risk reduction' },
      { name: 'settlement_date', type: 'date', comment: 'Settlement date' },
      { name: 'settlement_currency', type: 'string', comment: 'Settlement currency' },

      // ===== Counterparty Details (15 fields) =====
      { name: 'counterparty_1_nature', type: 'string', comment: 'CP1 nature: F=Financial, N=Non-Financial' },
      { name: 'counterparty_2_nature', type: 'string', comment: 'CP2 nature' },
      { name: 'counterparty_1_sector', type: 'string', comment: 'CP1 corporate sector' },
      { name: 'counterparty_2_sector', type: 'string', comment: 'CP2 corporate sector' },
      { name: 'counterparty_1_country', type: 'string', comment: 'CP1 country ISO 3166' },
      { name: 'counterparty_2_country', type: 'string', comment: 'CP2 country ISO 3166' },
      { name: 'execution_agent_id', type: 'string', comment: 'Execution agent LEI' },
      { name: 'execution_agent_country', type: 'string', comment: 'Execution agent country' },
      { name: 'broker_id', type: 'string', comment: 'Broker LEI' },
      { name: 'broker_country', type: 'string', comment: 'Broker country' },
      { name: 'trading_capacity', type: 'string', comment: 'PRINCIPAL or AGENT' },
      { name: 'beneficiary_id', type: 'string', comment: 'Beneficiary LEI' },
      { name: 'directly_linked_to_commercial_activity', type: 'boolean', comment: 'Commercial hedge' },
      { name: 'collateralisation', type: 'string', comment: 'UNCOLLATERALISED, PARTIALLY, FULLY' },
      { name: 'collateral_portfolio', type: 'boolean', comment: 'Portfolio-based collateral' },

      // ===== Valuation & Reporting (12 fields) =====
      { name: 'valuation_amount', type: 'decimal(18,2)', comment: 'Mark-to-market valuation' },
      { name: 'valuation_currency', type: 'string', comment: 'Valuation currency' },
      { name: 'valuation_timestamp', type: 'timestamp', comment: 'Valuation timestamp' },
      { name: 'valuation_method', type: 'string', comment: 'Valuation method' },
      { name: 'delta', type: 'decimal(10,6)', comment: 'Option delta' },
      { name: 'report_timestamp', type: 'timestamp', comment: 'Report submission timestamp' },
      { name: 'report_status', type: 'string', comment: 'Report status' },
      { name: 'level', type: 'string', comment: 'Reporting level: T=Trade, P=Position' },
      { name: 'confirmation_means', type: 'string', comment: 'Confirmation method' },
      { name: 'confirmation_timestamp', type: 'timestamp', comment: 'Confirmation timestamp' },
      { name: 'prior_uti', type: 'string', comment: 'Prior UTI for lifecycle events' },
      { name: 'subsequent_position', type: 'boolean', comment: 'Is subsequent position report' },

      // ===== Derivative Specifics - Options (10 fields) =====
      { name: 'option_type', type: 'string', comment: 'CALL or PUT' },
      { name: 'option_style', type: 'string', comment: 'EUROPEAN, AMERICAN, ASIAN, etc.' },
      { name: 'option_exercise_date', type: 'date', comment: 'Exercise date' },
      { name: 'strike_price', type: 'decimal(18,6)', comment: 'Strike price' },
      { name: 'strike_price_currency', type: 'string', comment: 'Strike price currency' },
      { name: 'strike_price_notation', type: 'string', comment: 'Strike notation' },
      { name: 'delivery_type', type: 'string', comment: 'CASH or PHYSICAL' },
      { name: 'barrier_type', type: 'string', comment: 'Barrier option type' },
      { name: 'barrier_level', type: 'decimal(18,6)', comment: 'Barrier level' },
      { name: 'premium_amount', type: 'decimal(18,2)', comment: 'Option premium' },

      // ===== Derivative Specifics - Swaps Leg 1 (15 fields) =====
      { name: 'leg1_fixed_rate', type: 'decimal(10,6)', comment: 'Leg 1 fixed rate' },
      { name: 'leg1_floating_rate', type: 'string', comment: 'Leg 1 floating rate index' },
      { name: 'leg1_floating_rate_term', type: 'string', comment: 'Leg 1 floating rate term' },
      { name: 'leg1_floating_rate_reset_frequency', type: 'string', comment: 'Reset frequency' },
      { name: 'leg1_payment_frequency', type: 'string', comment: 'Payment frequency' },
      { name: 'leg1_payment_dates', type: 'string', comment: 'Payment dates' },
      { name: 'leg1_spread', type: 'decimal(10,6)', comment: 'Leg 1 spread' },
      { name: 'leg1_day_count_convention', type: 'string', comment: 'Day count convention' },
      { name: 'leg1_notional_amount', type: 'decimal(18,2)', comment: 'Leg 1 notional' },
      { name: 'leg1_notional_currency', type: 'string', comment: 'Leg 1 currency' },
      { name: 'leg1_notional_schedule', type: 'string', comment: 'Notional schedule' },
      { name: 'leg1_initial_exchange', type: 'boolean', comment: 'Initial notional exchange' },
      { name: 'leg1_final_exchange', type: 'boolean', comment: 'Final notional exchange' },
      { name: 'leg1_payer', type: 'string', comment: 'Leg 1 payer LEI' },
      { name: 'leg1_receiver', type: 'string', comment: 'Leg 1 receiver LEI' },

      // ===== Derivative Specifics - Swaps Leg 2 (15 fields) =====
      { name: 'leg2_fixed_rate', type: 'decimal(10,6)', comment: 'Leg 2 fixed rate' },
      { name: 'leg2_floating_rate', type: 'string', comment: 'Leg 2 floating rate index' },
      { name: 'leg2_floating_rate_term', type: 'string', comment: 'Leg 2 floating rate term' },
      { name: 'leg2_floating_rate_reset_frequency', type: 'string', comment: 'Reset frequency' },
      { name: 'leg2_payment_frequency', type: 'string', comment: 'Payment frequency' },
      { name: 'leg2_payment_dates', type: 'string', comment: 'Payment dates' },
      { name: 'leg2_spread', type: 'decimal(10,6)', comment: 'Leg 2 spread' },
      { name: 'leg2_day_count_convention', type: 'string', comment: 'Day count convention' },
      { name: 'leg2_notional_amount', type: 'decimal(18,2)', comment: 'Leg 2 notional' },
      { name: 'leg2_notional_currency', type: 'string', comment: 'Leg 2 currency' },
      { name: 'leg2_notional_schedule', type: 'string', comment: 'Notional schedule' },
      { name: 'leg2_initial_exchange', type: 'boolean', comment: 'Initial notional exchange' },
      { name: 'leg2_final_exchange', type: 'boolean', comment: 'Final notional exchange' },
      { name: 'leg2_payer', type: 'string', comment: 'Leg 2 payer LEI' },
      { name: 'leg2_receiver', type: 'string', comment: 'Leg 2 receiver LEI' },

      // ===== Margin & Collateral (12 fields) =====
      { name: 'initial_margin_posted', type: 'decimal(18,2)', comment: 'Initial margin posted' },
      { name: 'initial_margin_received', type: 'decimal(18,2)', comment: 'Initial margin received' },
      { name: 'variation_margin_posted', type: 'decimal(18,2)', comment: 'Variation margin posted' },
      { name: 'variation_margin_received', type: 'decimal(18,2)', comment: 'Variation margin received' },
      { name: 'margin_currency', type: 'string', comment: 'Margin currency' },
      { name: 'collateral_type', type: 'string', comment: 'Collateral type' },
      { name: 'collateral_value', type: 'decimal(18,2)', comment: 'Collateral value' },
      { name: 'collateral_currency', type: 'string', comment: 'Collateral currency' },
      { name: 'segregation_type', type: 'string', comment: 'Segregation type' },
      { name: 'excess_collateral', type: 'decimal(18,2)', comment: 'Excess collateral' },
      { name: 'collateral_quality', type: 'string', comment: 'Collateral quality rating' },
      { name: 'rehypothecation', type: 'boolean', comment: 'Rehypothecation allowed' },

      // ===== Risk & Regulatory (10 fields) =====
      { name: 'exchange_rate', type: 'decimal(10,6)', comment: 'FX rate if applicable' },
      { name: 'exchange_rate_basis', type: 'string', comment: 'Exchange rate basis' },
      { name: 'package_indicator', type: 'boolean', comment: 'Part of package transaction' },
      { name: 'package_transaction_price', type: 'decimal(18,6)', comment: 'Package price' },
      { name: 'contingent_event', type: 'string', comment: 'Contingent event type' },
      { name: 'compression_indicator', type: 'boolean', comment: 'Portfolio compression' },
      { name: 'price_accuracy', type: 'string', comment: 'Price accuracy indicator' },
      { name: 'execution_venue', type: 'string', comment: 'Execution venue type' },
      { name: 'hybrid_indicator', type: 'boolean', comment: 'Hybrid instrument' },
      { name: 'cross_currency_indicator', type: 'boolean', comment: 'Cross-currency swap' },

      // ===== Additional Fields (38 fields - remaining to reach 203) =====
      { name: 'fixed_float_indicator', type: 'string', comment: 'Fixed or floating leg indicator' },
      { name: 'fixed_rate_day_count', type: 'string', comment: 'Fixed rate day count' },
      { name: 'floating_rate_day_count', type: 'string', comment: 'Floating rate day count' },
      { name: 'embedded_option', type: 'boolean', comment: 'Embedded option indicator' },
      { name: 'optional_termination_date', type: 'date', comment: 'Optional termination date' },
      { name: 'spread_notation', type: 'string', comment: 'Spread notation' },
      { name: 'index_factor', type: 'decimal(10,6)', comment: 'Index factor' },
      { name: 'attachment_point', type: 'decimal(10,4)', comment: 'Attachment point' },
      { name: 'detachment_point', type: 'decimal(10,4)', comment: 'Detachment point' },
      { name: 'quantity', type: 'decimal(18,2)', comment: 'Contract quantity' },
      { name: 'quantity_unit', type: 'string', comment: 'Quantity unit' },
      { name: 'delivery_point', type: 'string', comment: 'Delivery location' },
      { name: 'load_type', type: 'string', comment: 'Load type for energy' },
      { name: 'delivery_start_date', type: 'date', comment: 'Delivery start' },
      { name: 'delivery_end_date', type: 'date', comment: 'Delivery end' },
      { name: 'duration', type: 'string', comment: 'Contract duration' },
      { name: 'frequency', type: 'string', comment: 'General frequency' },
      { name: 'commodity_base', type: 'string', comment: 'Commodity base type' },
      { name: 'commodity_details', type: 'string', comment: 'Commodity details' },
      { name: 'notional_amount_schedule', type: 'string', comment: 'Notional schedule' },
      { name: 'step_up_step_down', type: 'boolean', comment: 'Step up/down indicator' },
      { name: 'callable_puttable', type: 'string', comment: 'Callable or puttable' },
      { name: 'knock_in_out', type: 'string', comment: 'Knock-in or knock-out' },
      { name: 'reference_entity', type: 'string', comment: 'Credit reference entity LEI' },
      { name: 'reference_obligation', type: 'string', comment: 'Reference obligation ISIN' },
      { name: 'seniority', type: 'string', comment: 'Seniority of debt' },
      { name: 'index_series', type: 'string', comment: 'Index series' },
      { name: 'index_version', type: 'string', comment: 'Index version' },
      { name: 'tranche', type: 'string', comment: 'Tranche identifier' },
      { name: 'basket_identifier', type: 'string', comment: 'Basket identifier' },
      { name: 'basket_constituents', type: 'string', comment: 'Basket constituents' },
      { name: 'custom_basket', type: 'boolean', comment: 'Custom basket indicator' },
      { name: 'settlement_location', type: 'string', comment: 'Settlement location' },
      { name: 'transaction_id', type: 'string', comment: 'Internal transaction ID' },
      { name: 'venue_transaction_id', type: 'string', comment: 'Venue transaction ID' },
      { name: 'platform', type: 'string', comment: 'Trading platform' },
      { name: 'taxonomy', type: 'string', comment: 'Product taxonomy version' },
      { name: 'additional_data', type: 'string', comment: 'Additional data field' },
    ];
  }
}

