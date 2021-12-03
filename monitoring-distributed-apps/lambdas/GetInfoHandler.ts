import { StepFunctions } from 'aws-sdk';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { captureAWSClient } from 'aws-xray-sdk';


const SM_ARN = process.env.STATE_MACHINE_ARN || '';
const stepfunctions = captureAWSClient(new StepFunctions());

export const handler: APIGatewayProxyHandler = async (event) => {

    console.log({ requestPath: event.path }, 'We have a new inboundRequest!');

    // Lets start a new step function execution.
    const inputParams: StepFunctions.StartExecutionInput = {
        stateMachineArn: SM_ARN,
        input: JSON.stringify({ demoData: 'Hello!' }),
    };
    const execute = await stepfunctions.startExecution(inputParams).promise();

    console.log({ executionArn: execute.executionArn }, 'We have started a new step function execution!');

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Success' }),
    };
};