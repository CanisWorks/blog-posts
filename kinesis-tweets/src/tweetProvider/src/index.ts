import AWS from 'aws-sdk';
import { PutRecordInput } from 'aws-sdk/clients/kinesis';
import axios from 'axios';
import { Writable } from 'stream';

type FilterRule = { value?: string; tag?: string; id: string };
type TweetData = { created_at: string; id: string; text: string };
type TwitterStreamResponse = { data: TweetData; matching_rules: FilterRule[] };

// Twitter API secret from env vars.
const TWITTER_API_TOKEN =  process.env.TWITTER_API_TOKEN || '';
const STREAM_NAME = process.env.KINESIS_STREAM_NAME || '';
const SEARCH_TERM = process.env.SEARCH_TERM || '';

// Axios http client setup with the Twitter search API endpoint.
const httpClient = axios.create({
    baseURL: 'https://api.twitter.com/2/tweets/search',
    headers: {
        Authorization: `Bearer ${TWITTER_API_TOKEN}`,
    }
});

// new Kinesis client from the AWS SDK.
const kinesis = new AWS.Kinesis();

// Twitter requires a rule setup to filter later calls to the stream endpoint. For this example the filter is by the provided single keyword. 
const createStreamRules = async (keyword: string): Promise<string> => {
    const rulesApiEndpointPath  = '/stream/rules';
    const ruleTag = ` tweets including ${keyword}`;
    
    // Check if the rule has already been setup.
    const getRulesResponse = await httpClient.get(rulesApiEndpointPath).catch((err) => {
        console.error(err);
        throw err;
    });
    console.log(getRulesResponse.request);
    const existingRules = getRulesResponse.data.data.filter((rule: FilterRule) => rule.tag === ruleTag);
    if (existingRules.length === 0) {
        // add a new rule to the stream.
        const addRules = { add: [ { value: keyword , tag: ruleTag }] };
        await httpClient.post(rulesApiEndpointPath, addRules).catch((err) => {
            console.error(err);
        });
        
        return 'Created a new rule!'
    }
    return 'Rule already setup!';
};

// Creates a twitter stream endpoint request and pipes the response data to the supplied writable stream.
// This demo is pretty basic and doesn't include retry logic, its good practice to add this so you can restart an errored connection.
const createStream = async (pipeTo: NodeJS.WritableStream): Promise<unknown> => {
    // Send a long running request to the Twitter stream endpoint that has a rule prevously setup on. Its important
    // | to set the request responseType to 'stream' so we can pipe the response data through to a provided write stream. 
    const response = await httpClient.get('/stream?tweet.fields=created_at', { responseType: 'stream' });
    response.data.pipe(pipeTo);
    return response;
};

// Calls the kinesis put record(s) action to push supplied data into a stream.
// | Kinesis throughput is limited to 1MiB or 1000 records per sec, per shard. For a more scalable
// | solution you will need to consider rate limiting requests per shard.
const writeToKinesis = (data: string): Promise<AWS.Kinesis.PutRecordOutput | null> => {
    const params: PutRecordInput = {
        Data: data,
        // This demo is only using a single shard, a better pk is required when using multiple shards.
        PartitionKey: 'pk_1',
        StreamName: STREAM_NAME,
    };
    // For this demo we don't care if a single put action fails so just log out the error message.
    return kinesis.putRecord(params).promise().catch((err) => {
        console.error(err.message);
        return null;
    });
};

const run = async () => {
    // search term for the twitter API filtered tweet stream.
    const searchTerm = SEARCH_TERM;
    // Create some API filter rules.
    const ruleResult = await createStreamRules(searchTerm);
    console.log('rule result', ruleResult);
    // setup a new write stream to pipe the Tweets API response data into.
    const putStream = new Writable();
    // Write action fired on every data chunk pushed into the stream.
    putStream._write = (chunk, _encoding, done) => {
        const data = chunk.toString();
        try {
            const record = JSON.parse(data) as TwitterStreamResponse;
            // fire and forget - sends the record into a kinesis stream.
            writeToKinesis(JSON.stringify(record.data));
        } catch (err) {
            console.error('failed to parse tweet data', err);
        }
        done();
    }
    // Create a new http call with a writable stream for the response data.
    await createStream(putStream);
    console.log('connected to stream!');
};

run();