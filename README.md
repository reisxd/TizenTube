# TizenTube

TizenTube is a NodeJS script that enhances your Tizen TV (2017 and newer) viewing experience by removing ads and adding support for Sponsorblock.

[Discord Server Invite](https://discord.gg/m2P7v8Y2qR)

## How it works

TizenTube operates by initiating a debugger session upon launching the app on your Tizen TV. This is achieved through the utilization of the `debug <app.id>` command, which establishes a connection between the server and the debugger. Once connected, the server is able to transmit JavaScript code that effectively removes video ads.

# TizenTube Installation Guide

## Prerequisites

- A PC capable of running Tizen Studio, which will be used to install TizenStudio onto your TV through SDB.
- A PC or Single Board Computer capable of running 24/7 (for ease of use) or the Android App.

## Installation Steps

1. **Enable Developer Mode** on your TV by following [this link](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).
2. **Install Tizen Studio** by following [this guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html).
     - Make sure to install the Tizen TV Extensions SDK. Although project's TV Extensions SDK version is 6.x.x, version 7.0.0 works too.
     - Also install the Samsung Certificate Extension
         - Note: This extension's installation on Tizen Studio 5.5 with IDE installer for **macOS** is broken. This breaks proper certificate creation (step 4). Therefore, avoid this macOS Tizen Studio version or use Windows/Ubuntu version.
3. **Connect to your TV** using [this guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html#:~:text=Connect%20the%20TV%20to%20the%20SDK%3A).
     - If opening Device Manager fails, use the _Launch Remote Device Manager_ option ([see here](https://stackoverflow.com/questions/67401253/device-manager-for-tizen-wont-open-0xc000007b))
4. **Create a Samsung certificate** using [this guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).
5. **Clone/download the repository** and open the `apps` folder of the repository in Tizen Studio by restarting Tizen Studio and changing the workspace.
6. In the `index.html` file of the Launcher app, change the `IP` variable to the IP of where your debugger will be installed. This could also be the IP of your android device if you plan on using that instead.
7. Ensure that your TV is selected at the top of Tizen Studio (the dropdown menu).
8. Right-click the `TizenTube` app and run it as a Tizen web application. Once that is done, do the same for the `Launcher` app.

After completing these steps, installing apps is complete! You should be able to see the apps on your TV. Now comes the easier part, installing the server or the debugger. You have two options to do this:

### Option 1: Install on PC/SBC

1. Download [NodeJS](https://nodejs.org/en) if you haven't already. Check by running the command `npm -v`.
2. Clone the repository.
3. Install modules by running `npm i` in the main folder of the repository.
4. Install mods modules by running `cd mods` and then running `npm i`.
5. Build mods by running `npm run build`.
6. Navigate back to the main folder of the repository by running `cd ..`.
7. Open `config.json` in your favorite text editor. Change `tvIP` to the IP of your TV. Make sure to leave the `appID` as it is (`Ad6NutHP8l.TizenTube`). Change `isTizen3` to true if your TV runs on Tizen 3.
8. Ensure that SDB is not running by going to Tizen's device manager and disconnecting your TV.
9. Change the development IP address on the TV (previously set in step 1 of Installation Steps above), to the IP of this PC that you'll run the node server on.
10. Start the node debugger/server using `node .`.

Once the server is up and running, you can access the Launcher app from your TV’s app menu. Please note that the TizenTube app will still display ads if it is run on its own. To remove ads, make sure to launch TizenTube through the Launcher app, which is connected to the server.

### Option 2: Use The Android App

1. First, change the Developer Mode's Host IP to your device's IP.
2. Download the latest APK compatible with your device's architecture from [here](https://github.com/reisxd/TizenTube/releases/tag/v1.1.2) (if unsure, download armeabi-v7a).
3. Install it.
4. After opening the app, change the configuration to suit your needs. Ensure that you set the `appID` to `Ad6NutHP8l.TizenTube` if it isn't already set. Change the IP to match that of your TV.
5. Change the development IP address on the TV (previously set in step 1 of Installation Steps) to that of this Android device which you'll run the server on.
6. Press 'Run Server'.
7. Press 'Launch' whenever you want to launch TizenTube.
8. Please note that if the app crashes, you may have made an error, such as setting an incorrect IP or failing to change the Developer Mode's Host IP.

And now you can launch TizenTube from your Android device!
