module.exports = function (config) {
  // Optional test-order control for deterministic CI / local isolation runs.
  // EP_TEST_RANDOM=0 disables shuffle; EP_TEST_SEED=<n> fixes the Jasmine seed.
  const testRandom = process.env.EP_TEST_RANDOM;
  const testSeed = process.env.EP_TEST_SEED;
  const jasmineClient = {};
  if (testRandom === '0') {
    jasmineClient.random = false;
  } else if (testRandom === '1') {
    jasmineClient.random = true;
  }
  if (testSeed) {
    jasmineClient.seed = testSeed;
    jasmineClient.random = true;
  }

  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    client: {
      jasmine: jasmineClient,
      clearContext: false,
    },
    reporters: ['progress'],
    port: 9333,
    listenAddress: '127.0.0.1',
    hostname: '127.0.0.1',
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    // ChromeHeadlessNoFlood disables Chromium's silent history.replaceState throttle
    // (~200 updates / ~10s per page). Specs share one Karma page; production browsers
    // never use this launcher.
    browsers: ['ChromeHeadlessNoFlood'],
    customLaunchers: {
      ChromeHeadlessNoFlood: {
        base: 'ChromeHeadless',
        flags: ['--disable-ipc-flooding-protection'],
      },
    },
    singleRun: true,
    restartOnFileChange: false,
    browserDisconnectTimeout: 10000,
    browserNoActivityTimeout: 30000,
    captureTimeout: 30000,
  });
};
