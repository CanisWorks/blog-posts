import { DynamoDB } from 'aws-sdk';
import { captureAWSClient } from 'aws-xray-sdk';
import { uuid } from 'uuidv4';

const TABLE_NAME = process.env.TABLE_NAME || '';

// adds x-ray coverage to dynamo calls (workaround to handle document client).
const dynamoClient = new DynamoDB.DocumentClient({
    service: new DynamoDB(),
});

captureAWSClient((dynamoClient as any).service);

type WriteToDbHandler = (event: { [key: string]: unknown }) => Promise<string>;
export const handler: WriteToDbHandler = async (event) => {
    console.log('writing to dynamo table...');

    // Write the input data to the dynamo table.
    await dynamoClient.put({
        TableName: TABLE_NAME,
        Item: { id: uuid() , ...event },
    }).promise();

    console.log('successfully written to dynamo table!');

    return 'done!';
};