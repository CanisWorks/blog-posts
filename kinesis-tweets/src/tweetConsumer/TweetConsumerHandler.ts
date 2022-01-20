import { KinesisStreamHandler } from "aws-lambda";
import * as AWS from 'aws-sdk';
import { PublishRequest } from "aws-sdk/clients/iotdata";

const TOPIC_NAME = process.env.TOPIC_NAME || '';
const IOT_ENDPOINT = process.env.IOT_ENDPOINT || '';

const iotData = new AWS.IotData({
    endpoint: IOT_ENDPOINT,
});

export const handler: KinesisStreamHandler = async (event) => {
    const { Records } = event;
    const publishParams: PublishRequest = {
        topic: TOPIC_NAME,
        payload: `[${Records.map((record) => Buffer.from(record.kinesis.data, 'base64').toString()).join(',')}]`,
        qos: 0,
    };
    await iotData.publish(publishParams).promise();
};