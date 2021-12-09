import { AmazonLinuxGeneration, AmazonLinuxImage, GatewayVpcEndpointAwsService, Instance, InstanceClass, InstanceSize, InstanceType, InterfaceVpcEndpointAwsService, InterfaceVpcEndpointService, MachineImage, Peer, Port, PrivateSubnet, PublicSubnet, SecurityGroup, SubnetType, Vpc } from "@aws-cdk/aws-ec2";
import { CompositePrincipal, Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "@aws-cdk/aws-iam";
import { Credentials, DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion } from "@aws-cdk/aws-rds";
import { CfnOutput, Construct, SecretValue, Stack, StackProps } from "@aws-cdk/core";


export class SsmAccessStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);
        
        // Application VPC components.
        const applicationVpc = new Vpc(this, 'applicationVpc', {
            cidr: '10.20.0.0/16',
            maxAzs: 2,
            subnetConfiguration: [{
                name: 'app-private-1',
                subnetType: SubnetType.PRIVATE_ISOLATED,
                cidrMask: 24,
            }],
        });
        // base security group with outbound access
        const applicationSecurityGroup = new SecurityGroup(this, 'appSecurityGroup', {
            allowAllOutbound: true,
            vpc: applicationVpc
        });

        // s3 access for package install instead of internet access.
        applicationVpc.addGatewayEndpoint('s3', {
            service: GatewayVpcEndpointAwsService.S3,
        })

        // These are the outbound service endpoints required for SSM to connect via PrivateLink
        const serviceEndpoints = [
            { name: 'ec2Messages', service: InterfaceVpcEndpointAwsService.EC2_MESSAGES },
            { name: 'ssm', service: InterfaceVpcEndpointAwsService.SSM },
            { name: 'ssmMessages', service: InterfaceVpcEndpointAwsService.SSM_MESSAGES },
        ];
        serviceEndpoints.forEach(({name, service}) => {
            applicationVpc.addInterfaceEndpoint(name, {
                service,
                subnets: applicationVpc.selectSubnets(),
                securityGroups: [applicationSecurityGroup],
                privateDnsEnabled: true,
            });
        });

        // IAM role for instance.
        const applicationInstanceSSMRole = new Role(this, 'appInstanceSSMRole', {
            roleName: 'app-ssm-access',
            assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [ ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
        });

        applicationInstanceSSMRole.addToPolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['s3:GetObject'],
            resources: [
                `arn:aws:s3:::aws-ssm-${this.region}/*`,
                `arn:aws:s3:::aws-windows-downloads-${this.region}/*`,
                `arn:aws:s3:::amazon-ssm-${this.region}/*`,
                `arn:aws:s3:::amazon-ssm-packages-${this.region}/*`,
                `arn:aws:s3:::${this.region}-birdwatcher-prod/*`,
                `arn:aws:s3:::aws-ssm-distributor-file-${this.region}/*`,
                `arn:aws:s3:::aws-ssm-document-attachments-${this.region}/*`,
                `arn:aws:s3:::patch-baseline-snapshot-${this.region}/*`,
            ],
        }));

        // EC2 instance.
        const applicationInstance = new Instance(this, 'applicationInstance', {
            vpc: applicationVpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_ISOLATED,
            },
            instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
            machineImage: new AmazonLinuxImage({ generation: AmazonLinuxGeneration.AMAZON_LINUX_2 }),
            role: applicationInstanceSSMRole,
            securityGroup: applicationSecurityGroup,
        });
        new CfnOutput(this, 'application instance id', { value: applicationInstance.instanceId });
        new CfnOutput(this, 'application instance IP', { value: applicationInstance.instancePrivateIp });

        // RDS instance.

        // Added rule for database connectivity.
        applicationSecurityGroup.addIngressRule(
            Peer.ipv4(applicationVpc.vpcCidrBlock),
            Port.tcp(5432),
            'allow connections into tcp 5432'
        );

        const applicationDatabase = new DatabaseInstance(this, 'applicationDatabase', {
            vpc: applicationVpc,
            vpcSubnets: {
                subnetType: SubnetType.PRIVATE_ISOLATED,
            },
            engine: DatabaseInstanceEngine.postgres({ version: PostgresEngineVersion.VER_13_4 }),
            // Never use the below creds config for production databases, this is just a demo.
            // Use secrets manager to store & rotate your RDS creds.
            credentials: Credentials.fromPassword('demouser', SecretValue.plainText('demodemo123456')),
            instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
            publiclyAccessible: false,
            securityGroups: [applicationSecurityGroup, ]
        });

        new CfnOutput(this, 'application DB address', { value: applicationDatabase.instanceEndpoint.socketAddress });
    }
}