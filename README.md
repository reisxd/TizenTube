# TizenTube

A NodeJS script to remove YouTube ads and add support for Sponsorblock for your Tizen TV (2017 and forward).

# TizenTube Installation Guide

## Prerequisites

- A PC capable of running Tizen Studio, which will be used to install TizenStudio onto your TV through SDB.
- A PC or Single Board Computer capable of running 24/7 (for ease of use) or the Android App. Your TV connects to the debugger and sends JS code to this debugger that removes video ads.

## Installation Steps

1. **Enable Developer Mode** on your TV by following [this link](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
2. **Install Tizen Studio** by following [this guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html). To determine the appropriate version of the SDK to install, check your TV's release year and [see which SDK version is recommended](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups.html).
3. **Connect to your TV** using [this guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html#:~:text=Connect%20the%20TV%20to%20the%20SDK%3A).
4. **Create a Samsung certificate** using [this guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).
5. **Clone/download the repository** and open the `apps` folder of the repository in Tizen Studio by restarting Tizen Studio and changing the workspace.
6. In the `index.html` file of the Launcher app, change the `IP` variable to the IP of where your debugger will be installed. This could also be the IP of your android device if you plan on using that instead.
7. Ensure that your TV is selected at the top of Tizen Studio (the dropdown menu).
8. Right-click the `TizenTube` app and run it as a Tizen web application. Once that is done, do the same for the `Launcher` app.

After completing these steps, installing apps is complete! You should be able to see the apps on your TV. Now comes the easier part, installing the server or the debugger.

### Option 1: Install on PC/SBC

1. Download NodeJS if you haven't already. Check by running the command `npm -v`.
2. Clone the repository.
3. Install modules by running `npm i` in the main folder of the repository.
4. Install mods modules by running `cd mods` and then running `npm i`.
5. Build mods by running `npm run build`.
6. Navigate back to the main folder of the repository by running `cd ..`.
7. Open `config.json` in your favorite text editor. Change `tvIP` to the IP of your TV. Make sure to leave the `appID` as it is. Change `isTizen3` to true if your TV runs on Tizen 3.
8. Ensure that SDB is not running by going to Tizen's device manager and disconnecting your TV.
9. Start the node debugger/server using `node .`.

And now you should have a server running! You should be able to go to your TV's apps, open either the Launcher app or TizenStudio and enjoy adless viewing.

### Option 2: Use The Android App

1. First, change the Developer Mode's Host IP to your device's IP.
2. Download the latest APK compatible with your device's architecture from [here](https://github.com/reisxd/TizenTube/releases/tag/v1.1.2) (if unsure, download armeabi-v7a).
3. Install it.
4. After opening the app, change the configuration to suit your needs. Ensure that you set the `appID` to `Ad6NutHP8l.TizenTube` if it isn't already set. Change the IP to match that of your TV.
5. Press 'Run Server'.
6. Press 'Launch' whenever you want to launch TizenTube.
7. Please note that if the app crashes, you may have made an error, such as setting an incorrect IP or failing to change the Developer Mode's Host IP.

And now you can launch TizenTube from your Android device!
