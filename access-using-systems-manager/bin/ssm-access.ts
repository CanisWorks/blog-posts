#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SsmAccessStack } from '../lib/ssm-access-stack';

const app = new cdk.App();

new SsmAccessStack(app, 'SsmAccessStack', {
  env: { region: 'eu-west-1' },
});
