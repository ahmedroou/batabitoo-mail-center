// Never inherit a previous APK hash. Verify the public artifact before activation.
process.argv.push('--write');
require('./scripts/publish_mobile_version.cjs');
