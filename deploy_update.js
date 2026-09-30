const fs = require('fs');
const { execSync } = require('child_process');

async function deploy() {
    console.log('Building Android Release APK...');
    try {
        execSync('cd android && gradlew assembleRelease', { stdio: 'inherit' });
    } catch (e) {
        console.error('Failed to build APK!');
        process.exit(1);
    }

    console.log('Copying APK to public/downloads...');
    fs.copyFileSync(
        'android/app/build/outputs/apk/release/app-release.apk',
        'public/downloads/Batabitoo-Mail-Center.apk'
    );

    console.log('Bumping app version to 1.5.1 in Firestore...');
    execSync('node update_version.js', { stdio: 'inherit' });

    console.log('Deploying to Firebase Hosting and Functions...');
    execSync('firebase deploy', { stdio: 'inherit' });

    console.log('Update deployed successfully!');
}

deploy();
