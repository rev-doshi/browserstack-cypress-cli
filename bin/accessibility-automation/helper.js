const logger = require("../helpers/logger").winstonLogger;
const { API_URL } = require('./constants');
const utils = require('../helpers/utils');
const fs = require('fs');
const path = require('path');
const request = require('request');
const os = require('os');
const glob = require('glob');
const helper = require('../helpers/helper');

exports.checkAccessibilityPlatform = (user_config) => {
  let accessibility = false;
  user_config.browsers.forEach(browser => {
    if (browser.accessibility) {
      accessibility = true;
      return true;
    }
  })
  return accessibility;
}

exports.setAccessibilityCypressCapabilities = async (user_config, accessibilityResponse) => {
  if (user_config.run_settings.accessibilityOptions) {

  } else {
    user_config.run_settings.accessibilityOptions = {}
  }
  user_config.run_settings.accessibilityOptions.authToken = accessibilityResponse.data.accessibilityToken;
  user_config.run_settings.accessibilityOptions.auth = accessibilityResponse.data.accessibilityToken;
  user_config.run_settings.accessibilityOptions.scannerVersion = accessibilityResponse.data.scannerVersion;
  user_config.run_settings.system_env_vars.push(`ACCESSIBILITY_AUTH=${accessibilityResponse.data.accessibilityToken}`)
  user_config.run_settings.system_env_vars.push(`ACCESSIBILITY_SCANNERVERSION=${accessibilityResponse.data.scannerVersion}`)
}

exports.createAccessibilityTestRun = async (user_config, framework) => {

  const userName = user_config["auth"]["username"];
  const accessKey = user_config["auth"]["access_key"];

  try {
    let settings = user_config.run_settings.accessibilityOptions;

    const {
      buildName,
      projectName,
      buildDescription
    } = getBuildDetails(user_config);

    const data = {
      'projectName': projectName,
      'buildName': buildName,
      'startTime': (new Date()).toISOString(),
      'description': buildDescription,
      'source': {
        frameworkName: "Cypress",
        frameworkVersion: helper.getPackageVersion('cypress', user_config),
        sdkVersion: helper.getAgentVersion()
      },
      'settings': settings,
      'versionControl': await helper.getGitMetaData(),
      'ciInfo':  helper.getCiInfo(),
      'hostInfo': {
        hostname: os.hostname(),
        platform: os.platform(),
        type: os.type(),
        version: os.version(),
        arch: os.arch()
      },
      'browserstackAutomation': process.env.BROWSERSTACK_AUTOMATION
    };

    const config = {
      auth: {
        user: userName,
        pass: accessKey
      },
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const response = await nodeRequest(
      'POST', 'test_runs', data, config
    );
    logger.info("response in createAccessibilityTestRun", response);
    process.env.BROWSERSTACK_TEST_ACCESSIBILITY = 'true';
    process.env.BS_A11Y_JWT = response.data.data.accessibilityToken;
    process.env.BS_A11Y_TEST_RUN_ID = response.data.data.id;
  
    this.setAccessibilityCypressCapabilities(user_config, response.data);
    setAccessibilityEventListeners();
          // setEventListeners();


  } catch (error) {
    if (error.response) {
      logger.error(
        `Exception while creating test run for BrowserStack Accessibility Automation: ${
          error.response.status
        } ${error.response.statusText} ${JSON.stringify(error.response.data)}`
      );
    } else {
      if(error.message == 'Invalid configuration passed.') {
        logger.error(
          `Exception while creating test run for BrowserStack Accessibility Automation: ${
            error.message || error.stack
          }`
        );
        for(const errorkey of error.errors){
          logger.error(errorkey.message);
        }
        
      } else {
        logger.error(
          `Exception while creating test run for BrowserStack Accessibility Automation: ${
            error.message || error.stack
          }`
        );
      }
      // since create accessibility session failed
      process.env.BROWSERSTACK_TEST_ACCESSIBILITY = 'false';
      user_config.run_settings.accessibility = false; 
    }
  }
}

const nodeRequest = (type, url, data, config) => {
  logger.info("API URL IN noderequest", API_URL);
  return new Promise(async (resolve, reject) => {
    const options = {...config,...{
      method: type,
      url: `${API_URL}/${url}`,
      body: data,
      json: config.headers['Content-Type'] === 'application/json',
    }};

    request(options, function callback(error, response, body) {
      if(error) {
        logger.info("error in nodeRequest", error);
        reject(error);
      } else if(!(response.statusCode == 201 || response.statusCode == 200)) {
        logger.info("response.statusCode in nodeRequest", response.statusCode);
        reject(response && response.body ? response.body : `Received response from BrowserStack Server with status : ${response.statusCode}`);
      } else {
        try {
          if(typeof(body) !== 'object') body = JSON.parse(body);
        } catch(e) {
          if(!url.includes('/stop')) {
            reject('Not a JSON response from BrowserStack Server');
          }
        }
        resolve({
          data: body
        });
      }
    });
  });
}

const getBuildDetails = (bsConfig) => {
  let buildName = '',
      projectName = '',
      buildDescription = '',
      buildTags = [];
  
  /* Pick from environment variables */
  buildName = process.env.BROWSERSTACK_BUILD_NAME || buildName;
  projectName = process.env.BROWSERSTACK_PROJECT_NAME || projectName;
  
  /* Pick from run settings */
  buildName = buildName || bsConfig["run_settings"]["build_name"];
  projectName = projectName || bsConfig["run_settings"]["project_name"];
  if(!utils.isUndefined(bsConfig["run_settings"]["build_tag"])) buildTags = [...buildTags, bsConfig["run_settings"]["build_tag"]];

  buildName = buildName || path.basename(path.resolve(process.cwd()));

  return {
    buildName,
    projectName,
    buildDescription,
    buildTags
  };
}

const getAccessibilityCypressCommandEventListener = () => {
  return (
    `require('browserstack-cypress-cli/bin/accessibility-automation/cypress');`
  );
}

const setAccessibilityEventListeners = () => {
  logger.info("setAccessibilityEventListeners")
  try {
    const cypressCommandEventListener = getAccessibilityCypressCommandEventListener();
    glob(process.cwd() + '/cypress/support/*.js', {}, (err, files) => {
      if(err) return logger.debug('EXCEPTION IN BUILD START EVENT : Unable to parse cypress support files');
      files.forEach(file => {
        try {
          if(!file.includes('commands.js')) {
            const defaultFileContent = fs.readFileSync(file, {encoding: 'utf-8'});
            
            if(!defaultFileContent.includes(cypressCommandEventListener)) {
              let newFileContent =  defaultFileContent + 
                                  '\n' +
                                  cypressCommandEventListener +
                                  '\n'
              fs.writeFileSync(file, newFileContent, {encoding: 'utf-8'});
              supportFileContentMap[file] = defaultFileContent;
            }
          }
        } catch(e) {
          logger.debug(`Unable to modify file contents for ${file} to set event listeners with error ${e}`, true, e);
        }
      });
    });
  } catch(e) {
    logger.debug(`Unable to parse support files to set event listeners with error ${e}`, true, e);
  }
}
