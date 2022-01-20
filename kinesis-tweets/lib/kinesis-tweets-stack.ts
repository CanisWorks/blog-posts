import { CfnOutput, CfnParameter, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { CfnIdentityPool, CfnIdentityPoolRoleAttachment } from 'aws-cdk-lib/aws-cognito';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { AwsLogDriver, Cluster, ContainerImage, EnvironmentFile, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { Effect,  FederatedPrincipal,  PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Stream } from 'aws-cdk-lib/aws-kinesis';
import { Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { KinesisEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { join } from 'path';

export class KinesisTweetsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Params from CDK CLI 
    const iotCoreEndpoint = new CfnParameter(this, 'iotEndpoint', {
      type: 'String',
      description: 'The account endpoint for iot data (found on the console settings page).',
    });

    // The client name for the demo app to use to connect to the iot websocket.
    const CognitoClientId = 'democlient';

    // pub / sub topic name (used by iot core & client web app).
    const topicName = 'demo/tweets';

    // The term used to filter the tweet stream from the twitter API.
    // FYI #bitcoin search term will get you a lot of tweets streaming from the Twitter API 
    const twitterSearchTerm = '#bitcoin';

    // Kinesis stream
    const streamName = 'demo-tweet-stream';
    const stream = new Stream(this, 'tweetStream', {
      streamName,
      shardCount: 1,
      retentionPeriod: Duration.hours(24),
    });

    // Kinesis stream put Permissions for provider.
    const allowPutDemoStreamPolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['kinesis:PutRecord'],
      resources: [stream.streamArn],
    });



    // Creates a new VPC for provider cluster to reside in.
    const providerVpc = new Vpc(this, 'providerVpc', {
      cidr: '10.20.0.0/16',
      maxAzs: 2,
      subnetConfiguration: [{
        name: 'provider-private-1',
        subnetType: SubnetType.PRIVATE_WITH_NAT,
        cidrMask: 24,
      },
      {
        name: 'provider-public-1',
        subnetType: SubnetType.PUBLIC,
        cidrMask: 24,
      }
    ]
    });

    // Add a security group with an outbound rule to the vpc.
    const providerSecurityGroup = new SecurityGroup(this, 'providerSecGroup', {
      allowAllOutbound: true,
      vpc: providerVpc,
    });

    // Creates a new cluster for the tweet provider.
    const cluster = new Cluster(this, 'providerCluster', {
      clusterName: 'tweetProviderCluster',
      vpc: providerVpc,
    });
    new CfnOutput(this, 'cluster arn', { value: cluster.clusterArn });

    const clusterLogging = new AwsLogDriver({ streamPrefix: 'ecs-logs'});
    
    const taskRole = new Role(this, 'ecsTaskRole', {
      roleName: `ecs-task-${this.stackName}`,
      assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // container IAM permissions.
    const executionRolePolicy = new PolicyStatement({
      effect: Effect.ALLOW,
      resources: ['*'],
      actions: [
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ]
    });

    // create a new fargate task.
    const fargateTaskDef = new FargateTaskDefinition(this, 'ecsTaskDef', {
      taskRole,
    });

    // Add required permissions to the task definition.
    fargateTaskDef.addToExecutionRolePolicy(executionRolePolicy);
    fargateTaskDef.addToTaskRolePolicy(allowPutDemoStreamPolicy);

    // builds a docker image from the tweetProvider directory.
    const providerDockerImage = new DockerImageAsset(this, 'tweetProviderImg', {
      directory: join(__dirname, '../src/tweetProvider'),
    });

    // setup a container for the cluster task.
    const container = fargateTaskDef.addContainer('tweetProviderContainer', {
      image: ContainerImage.fromDockerImageAsset(providerDockerImage),
      memoryLimitMiB: 256,
      cpu: 256,
      logging: clusterLogging,
      /* Hardcoded envars for demo purposes only, in real applications env vars should never be baked directly into cdk.
      * | Instead its best to use the 'secrets' attribute and store your sensitive env vars in Parameter store or Secrets manager.
      * | more info: https://aws.amazon.com/premiumsupport/knowledge-center/ecs-data-security-container-task/
      * */
      environment: { KINESIS_STREAM_NAME: streamName, TWITTER_SEARCH_TERM: twitterSearchTerm, TWITTER_API_TOKEN: '<TWITTER_TOKEN>' },
    });
    container.addPortMappings({ containerPort: 3000 });

    new CfnOutput(this, 'container name', { value: container.containerName });

    // setup fargate managed ecs cluster.
    const fargateService = new ApplicationLoadBalancedFargateService(this, 'tweetFargateService', {
      cluster,
      taskDefinition: fargateTaskDef,
      publicLoadBalancer: false,
      desiredCount: 1,
      securityGroups: [ providerSecurityGroup ],
      assignPublicIp: false,
    });


    // Lambda stream consumer.
    const functionProps: NodejsFunctionProps = {
      handler: 'handler',
      bundling: {
        externalModules: ['aws-sdk'],
      },
      depsLockFilePath: join(__dirname, '../src/tweetConsumer', 'package-lock.json'),
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.seconds(10),
    };

    // create a new NodeJS lambda function. 
    const consumerLambda = new NodejsFunction(this, 'consumerLambda', {
      ...functionProps,
      entry: join(__dirname, '../src/tweetConsumer', 'TweetConsumerHandler.ts'),
      environment: {
        TOPIC_NAME: topicName,
        IOT_ENDPOINT: iotCoreEndpoint.valueAsString,
      }
    });

    // Allow lambda function to  
    stream.grantRead(consumerLambda);

    // Assign lambda to kinesis as an event source.
    const streamEventSource = new KinesisEventSource(stream, {
      startingPosition: StartingPosition.LATEST,
      batchSize: 4, // invokes lambda after 4 records are received (adds a small buffer delay).
    });
    consumerLambda.addEventSource(streamEventSource);


    // adds publish permissions to the consumer Lambda.
    consumerLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iot:Publish'],
      resources:['*'],
    }));

    // Cognito ID pool for assigning permissions to client app for iot connection.
    const identityPool = new CfnIdentityPool(this, 'clientIdentityPool', {
      // For the demo we are going to allow access to anonymous users - no sign in required.
      allowUnauthenticatedIdentities: true,
      identityPoolName: 'tweetDemoPool',
    });

    // pool id is required for the browser demo app 
    new CfnOutput(this, 'Cognito pool id', { value: identityPool.ref });

    //Role for the anonymous Cognito users.
    const anonymousCognitoRole = new Role(this, 'anonymousCognitoRole', {
      roleName: 'tweetDemoCognitoRole',
      description: 'role used by anonymous Cognito users',
      // Cognito trust policy targeting the id pool (not just any pool)
      // | more info: https://docs.aws.amazon.com/cognito/latest/developerguide/iam-roles.html
      assumedBy: new FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': identityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
        },
        'sts:AssumeRoleWithWebIdentity'),
    });

    // adds an iot client connection policy to the cognito role.
    anonymousCognitoRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iot:Connect'],
      resources: [`arn:aws:iot:${this.region}:${this.account}:client/${CognitoClientId}`]
    }));

    // adds an iot subcribe policy to the cognito role.
    anonymousCognitoRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iot:Subscribe'],
      resources: [`arn:aws:iot:${this.region}:${this.account}:topicfilter/${topicName}`]
    }));
    anonymousCognitoRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['iot:Receive'],
      resources: [`arn:aws:iot:${this.region}:${this.account}:topic/${topicName}`]
    }))

    // links the Cognito role to the identity pool.
    new CfnIdentityPoolRoleAttachment(this, 'idPoolRoleAttachement', {
      identityPoolId: identityPool.ref,
      roles: {
        unauthenticated: anonymousCognitoRole.roleArn,
      }
    });
  }
}
