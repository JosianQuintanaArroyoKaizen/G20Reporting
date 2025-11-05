import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { Runtime, Function as LambdaFunction, Code } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";

interface SwnMicroservicesProps {
    productTable: ITable;
    basketTable: ITable;
    orderTable: ITable;
}

export class SwnMicroservices extends Construct {

  public readonly productMicroservice: LambdaFunction;
  public readonly basketMicroservice: LambdaFunction;
  public readonly orderingMicroservice: LambdaFunction;

  constructor(scope: Construct, id: string, props: SwnMicroservicesProps) {
    super(scope, id);

    // product microservices (simplified placeholder)
    this.productMicroservice = this.createProductFunction(props.productTable);
    // basket microservices (simplified placeholder)
    this.basketMicroservice = this.createBasketFunction(props.basketTable);
    // ordering Microservice (simplified placeholder)
    this.orderingMicroservice = this.createOrderingFunction(props.orderTable);
  }

  private createProductFunction(productTable: ITable): LambdaFunction {
    // Simplified placeholder Lambda - no bundling required
    const productFunction = new LambdaFunction(this, 'productLambdaFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Product Lambda - Placeholder for EMIR project');
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: 'Product service placeholder - will be replaced with EMIR lambdas',
              table: '${productTable.tableName}'
            })
          };
        };
      `),
      environment: {
        PRIMARY_KEY: 'id',
        DYNAMODB_TABLE_NAME: productTable.tableName
      },
      timeout: Duration.seconds(10)
    });

    productTable.grantReadWriteData(productFunction);
    return productFunction;
  }

  private createBasketFunction(basketTable: ITable): LambdaFunction {
    // Simplified placeholder Lambda - no bundling required
    const basketFunction = new LambdaFunction(this, 'basketLambdaFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Basket Lambda - Placeholder for EMIR project');
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: 'Basket service placeholder - will be replaced with EMIR lambdas',
              table: '${basketTable.tableName}'
            })
          };
        };
      `),
      environment: {
        PRIMARY_KEY: 'userName',
        DYNAMODB_TABLE_NAME: basketTable.tableName,
        EVENT_SOURCE: "com.swn.basket.checkoutbasket",
        EVENT_DETAILTYPE: "CheckoutBasket",
        EVENT_BUSNAME: "SwnEventBus"
      },
      timeout: Duration.seconds(10)
    });

    basketTable.grantReadWriteData(basketFunction);
    return basketFunction;
  }

  private createOrderingFunction(orderTable: ITable): LambdaFunction {
    // Simplified placeholder Lambda - no bundling required
    const orderFunction = new LambdaFunction(this, 'orderingLambdaFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline(`
        exports.handler = async (event) => {
          console.log('Ordering Lambda - Placeholder for EMIR project');
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: 'Ordering service placeholder - will be replaced with EMIR lambdas',
              table: '${orderTable.tableName}'
            })
          };
        };
      `),
      environment: {
        PRIMARY_KEY: 'userName',
        SORT_KEY: 'orderDate',
        DYNAMODB_TABLE_NAME: orderTable.tableName
      },
      timeout: Duration.seconds(10)
    });

    orderTable.grantReadWriteData(orderFunction);
    return orderFunction;
  }

}