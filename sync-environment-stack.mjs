#!/usr/bin/env zx

const TEMP_CLONE_REPO_PATH = '/tmp/clonedRepoFolder';
const {targetRepositoryUrl, gitToken} = inputs;
const {ENV0_ENVIRONMENT_NAME, ENV0_PROJECT_NAME, ENV0_TEMPLATE_REPOSITORY} = process.env;
const deploymentDirectory = await $`pwd`;
const targetRepositoryFolder = `${TEMP_CLONE_REPO_PATH}/${ENV0_PROJECT_NAME}/${ENV0_ENVIRONMENT_NAME}`;

await setup(targetRepositoryUrl, gitToken);

const mainCode = await generateTerraformMainCode(ENV0_ENVIRONMENT_NAME, ENV0_TEMPLATE_REPOSITORY, getEnvironmentJsonVariables(deploymentDirectory), getEnvironmentHclVariables(deploymentDirectory));
await $`echo "${mainCode}" > ${targetRepositoryFolder}/main.tf`;

await copyTerraformFiles(deploymentDirectory, targetRepositoryFolder);

// will use git & github cli to commit and push changes create the PR and merge it
// await $`git checkout -b add-${ENV0_ENVIRONMENT_NAME.replace(/\s/g, '-')}-stack`;
await commitAndPushChanges(targetRepositoryFolder, ENV0_ENVIRONMENT_NAME);

await cleanup();


// Write main.tf

const setup = async (repositoryUrl) => {
    await $`gh auth login --with-token < $ENV0_VCS_ACCESS_TOKEN`;
    await $`git clone -n ${repositoryUrl} --depth 1 ${TEMP_CLONE_REPO_PATH}`
    await $`cd ${TEMP_CLONE_REPO_PATH}`;
};

const copyTerraformFiles = async (sourceFolder, targetRepositoryFolder) => {
    // Copy variable files
    await $`cp ${sourceFolder}/auto.tfvars ${targetRepositoryFolder}/auto.tfvars`;
    await $`cp ${sourceFolder}/auto.tfvars.json ${targetRepositoryFolder}/auto.tfvars.json`;

    // Copy backend.tf from env0 generated files (one should exist)
    const backendCpCommand = (backendFile) => `cp ${sourceFolder}/${backendFile} ${targetRepositoryFolder}/backend.tf`
    await $`[ -f "${sourceFolder}/env0_remote_backend_override.tf" ] \
            && ${backendCpCommand('env0_remote_backend_override.tf')} \
            || ${backendCpCommand('env0_custom_backend_override.tf')}`;
    // Copy .terraform.lock.hcl
    await $`cp ${sourceFolder}/.terraform.lock.hcl ${targetRepositoryFolder}/.terraform.lock.hcl`;
}
const getEnvironmentJsonVariables = async (sourceFolder) => {
    const tfvars = await fs.readJson(`${sourceFolder}/auto.tfvars.json`)
    return Object.entries(tfvars).map(([name, value]) => ({name, value}));
};

const getEnvironmentHclVariables = async (sourceFolder) => {
    const tfvars = await fs.readFile(`${sourceFolder}/auto.tfvars`, 'utf8');
    return tfvars.split('\n').map((line) => {
        const [name, value] = line.split('=');
        return {name: name.trim(), value: value.trim()};
    });
};


const generateTerraformMainCode = async (environmentName, templateRepository, jsonVariables, hclVariables) => {
    const mergedVariables = new Map([...jsonVariables, ...hclVariables]);
    const variableDeclarationList = mergedVariables.map(({name, value}) => `variable "${name}" {}`).join('\n');
    const variableModuleUsage = mergedVariables.map(({name, value}) => `    ${name} = var.${name}`).join('\n');

    return ```
    ${variableDeclarationList}
    
    module "${environmentName}" {
        source = "${templateRepository}"
        ${variableModuleUsage}
    }
    
    ```;
};