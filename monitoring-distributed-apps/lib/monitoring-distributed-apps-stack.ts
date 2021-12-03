import * as cdk from '@aws-cdk/core';
import { NodejsFunction, NodejsFunctionProps } from '@aws-cdk/aws-lambda-nodejs';
import { join } from 'path';
import { Runtime, Tracing } from '@aws-cdk/aws-lambda';
import { AttributeType, Table } from '@aws-cdk/aws-dynamodb';
import { RemovalPolicy } from '@aws-cdk/core';
import { LambdaIntegration, RestApi } from '@aws-cdk/aws-apigateway';
import { LambdaInvoke } from '@aws-cdk/aws-stepfunctions-tasks';
import { StateMachine, StateMachineType, Wait, WaitTime } from '@aws-cdk/aws-stepfunctions';

export class MonitoringDistributedAppsStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const infoTableName = 'info_table';

    // Lambdas 
    const functionProps: NodejsFunctionProps = {
      handler: 'handler',
      bundling: {
        externalModules: [
          'aws-sdk' // include the preexisting sdk in the lambda runtime env. 
        ]
      },
      depsLockFilePath: join(__dirname, '../lambdas', 'package-lock.json'),
      runtime: Runtime.NODEJS_14_X,
      tracing: Tracing.ACTIVE,
      timeout: cdk.Duration.seconds(30),
    };

    const getInfoLambda = new NodejsFunction(this, 'GetInfoLambda', {
      entry: join(__dirname, '../lambdas', 'GetInfoHandler.ts'),
      ...functionProps,
    });

    const writeToDbLambda = new NodejsFunction(this, 'WriteToDbLambda', {
      
      entry: join(__dirname, '../lambdas', 'WriteToDbHandler.ts'),
      environment: {
        TABLE_NAME: infoTableName,
      },
      ...functionProps,
    });

    // Dynamo Table
    const infoTable = new Table(this, 'InfoTable', {
      tableName: infoTableName,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      removalPolicy: RemovalPolicy.DESTROY, // Don't do this in prod. 
    });

    infoTable.grantReadWriteData(writeToDbLambda);
    
    // Http API
    const apiGateway = new RestApi(this, 'ApplicationApiGw', {
      restApiName: 'Monitoring Demo',
      deployOptions: { stageName: 'demo', tracingEnabled: true },
    });

    const getInfoApiIntegration = new LambdaIntegration(getInfoLambda);
    const infoRoot = apiGateway.root.addResource('info');
    infoRoot.addMethod('GET', getInfoApiIntegration);

    // Step Functions
    const submitToDbTask = new LambdaInvoke(this, 'Submit to DB', {
      lambdaFunction: writeToDbLambda
    });
    const waitStep = new Wait(this, 'Wait 10 Secs', {
      time: WaitTime.duration(cdk.Duration.seconds(10)),
    });

    const taskDefinition = waitStep.next(submitToDbTask);

    const stateMachine = new StateMachine(this, 'Wait and Submit to DB', {
      stateMachineName: 'WaitAndSubmitToDB',
      definition: taskDefinition,
      timeout: cdk.Duration.minutes(2),
      tracingEnabled: true,
      stateMachineType: StateMachineType.STANDARD,
    });

    //getInfoLambda.addP
    stateMachine.grantStartExecution(getInfoLambda);
    writeToDbLambda.grantInvoke(stateMachine.role);
    getInfoLambda.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
  }
}
