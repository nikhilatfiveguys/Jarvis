const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'com.assistive.runtime',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID || 'aaronsoni06@gmail.com',
    appleIdPassword: process.env.APPLE_ID_PASSWORD || 'lijb-fdhv-oqmj-cwwp',
    teamId: process.env.APPLE_TEAM_ID || 'DMH3RU9FQQ',
  });
};