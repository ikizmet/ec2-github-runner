const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceId, region) {
  core.setOutput('label', label);
  core.setOutput('ec2-instance-id', ec2InstanceId);
  core.setOutput('region', region);
}

async function start() {
  const label = Math.random().toString(36).substr(2, 5);
  const githubRegistrationToken = await gh.getRegistrationToken();
  const result = await aws.startEc2Instance(label, githubRegistrationToken);
  const ec2InstanceId = result.ec2InstanceId;
  const region = result.region;
  
  // Set outputs
  setOutput(label, ec2InstanceId, region);
  
  // Wait for the instance to be running
  await aws.waitForInstanceRunning(ec2InstanceId, region);
  await gh.waitForRunnerRegistered(label);
}

async function stop() {
  await aws.terminateEc2Instance();
  await gh.removeRunner();
}

(async function() {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
