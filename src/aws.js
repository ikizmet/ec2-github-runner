const {
    EC2Client,
    RunInstancesCommand,
    TerminateInstancesCommand,
    waitUntilInstanceRunning,
    RequestSpotInstancesCommand,
    DescribeSpotInstanceRequestsCommand
} = require('@aws-sdk/client-ec2');

const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
    if (config.input.runnerHomeDir) {
        return [
            '#!/bin/bash',
            `cd "${config.input.runnerHomeDir}"`,
            `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
            'source pre-runner-script.sh',
            'export RUNNER_ALLOW_RUNASROOT=1',
            `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${config.input.runnerName}`,
            './run.sh'
        ];
    } else {
        return [
            '#!/bin/bash',
            'mkdir actions-runner && cd actions-runner',
            `echo "${config.input.preRunnerScript}" > pre-runner-script.sh`,
            'source pre-runner-script.sh',
            'export RUNNER_VERSION="2.322.0"',
            'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
            `curl -O -L https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-$\{RUNNER_ARCH}-\${RUNNER_VERSION}.tar.gz`,
            'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz',
            'export RUNNER_ALLOW_RUNASROOT=1',
            `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --name ${config.input.runnerName}`,
            './run.sh'
        ];
    }
}

async function startEc2Instance(label, githubRegistrationToken) {
    const ec2 = new EC2Client();
    const userData = buildUserDataScript(githubRegistrationToken, label);
    const params = {
        ImageId: config.input.ec2ImageId,
        InstanceType: config.input.ec2InstanceType,
        MaxCount: 1,
        MinCount: 1,
        SecurityGroupIds: [config.input.securityGroupId],
        SubnetId: config.input.subnetId,
        UserData: Buffer.from(userData.join('\n')).toString('base64'),
        IamInstanceProfile: {Name: config.input.iamRoleName},
        TagSpecifications: config.tagSpecifications
    };

    try {
        const result = await ec2.send(new RunInstancesCommand(params));
        const ec2InstanceId = result.Instances[0].InstanceId;
        core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
        return ec2InstanceId;
    } catch (error) {
        core.error('AWS EC2 instance starting error');
        throw error;
    }
}

async function startEc2SpotInstance(label, githubRegistrationToken) {
    const ec2 = new EC2Client();
    const userData = buildUserDataScript(githubRegistrationToken, label);
    const params = {
        InstanceCount: 1, // Request one spot instance
        Type: "one-time", // Ensures it's a single-use spot instance

        LaunchSpecification: {
            ImageId: config.input.ec2ImageId,
            InstanceType: config.input.ec2InstanceType,
            SecurityGroupIds: [config.input.securityGroupId],
            SubnetId: config.input.subnetId,
            UserData: Buffer.from(userData.join("\n")).toString("base64"),
            IamInstanceProfile: {Name: config.input.iamRoleName},
            TagSpecifications: config.tagSpecifications,
        },
    };

    try {
        const spotRequestResult = await ec2.send(new RequestSpotInstancesCommand(params));
        const spotRequestId = spotRequestResult.SpotInstanceRequests[0].SpotInstanceRequestId;
        core.info(`Spot Instance request submitted: ${spotRequestId}`);

        let ec2InstanceId = null;
        while (!ec2InstanceId) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5 seconds
            const describeSpotRequests = await ec2.send(
                new DescribeSpotInstanceRequestsCommand({SpotInstanceRequestIds: [spotRequestId]})
            );

            const spotRequest = describeSpotRequests.SpotInstanceRequests[0];
            if (spotRequest.InstanceId) {
                ec2InstanceId = spotRequest.InstanceId;
                core.info(`Spot Instance ${ec2InstanceId} is launched`);
            }
        }
        return ec2InstanceId;
    } catch (error) {
        core.error("AWS EC2 Spot Instance starting error");
        throw error;
    }
}

async function terminateEc2Instance() {
    const ec2 = new EC2Client();
    const params = {InstanceIds: [config.input.ec2InstanceId]};
    try {
        await ec2.send(new TerminateInstancesCommand(params));
        core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    } catch (error) {
        core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
        throw error;
    }
}

async function waitForInstanceRunning(ec2InstanceId) {
    const ec2 = new EC2Client();
    try {
        core.info(`Checking for instance ${ec2InstanceId} to be up and running`);
        await waitUntilInstanceRunning(
            {
                client: ec2,
                maxWaitTime: 300,
            }, {
                Filters: [{Name: 'instance-id', Values: [ec2InstanceId]}],
            });
        core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    } catch (error) {
        core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
        throw error;
    }
}

module.exports = {
    startEc2Instance,
    startEc2SpotInstance,
    terminateEc2Instance,
    waitForInstanceRunning
};
